import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { generateKeyPairSync, privateDecrypt, constants } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const repo = new URL('../', import.meta.url)

async function text(path) {
  return readFile(new URL(path, repo), 'utf8')
}

async function importTypeScriptModule(path) {
  const ts = await import('typescript')
  const source = await text(path)
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)
}

function parseMcpResponse(raw) {
  const text = raw.trim()
  if (text.startsWith('{')) return JSON.parse(text)
  const line = text.split(/\r?\n/).find((value) => value.startsWith('data:'))
  return line ? JSON.parse(line.slice(5).trim()) : null
}

async function postMcp(url, body, bearer = 'test-bearer') {
  return fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

test('server policy uses an exact least-privilege tool list', async () => {
  const { SAFE_TOOL_NAMES } = await import('../mcp/policy.mjs')

  assert.equal(SAFE_TOOL_NAMES.length, 32)
  assert.equal(new Set(SAFE_TOOL_NAMES).size, SAFE_TOOL_NAMES.length)

  const forbidden = [
    /send/i,
    /campaign_status/i,
    /delete/i,
    /blocklist/i,
    /import/i,
    /optin/i,
    /set_default/i,
    /manage_subscriber_list_membership/i,
    /create_subscriber/i,
    /update_subscriber/i,
    /update_campaign$/i,
    /get_settings$/i,
    /get_logs$/i,
  ]

  for (const pattern of forbidden) {
    assert.equal(
      SAFE_TOOL_NAMES.some((name) => pattern.test(name)),
      false,
      `unsafe MCP tool matched ${pattern}`,
    )
  }
})

test('dedicated Listmonk role excludes send and subscriber mutation permissions', async () => {
  const { LISTMONK_ROLE_PERMISSIONS } = await import('../mcp/policy.mjs')

  for (const permission of [
    'campaigns:send',
    'campaigns:get_all',
    'campaigns:manage_all',
    'subscribers:manage',
    'subscribers:import',
    'bounces:manage',
    'settings:get',
  ]) {
    assert.equal(
      LISTMONK_ROLE_PERMISSIONS.includes(permission),
      false,
      `${permission} must not be granted`,
    )
  }

  for (const permission of [
    'lists:get_all',
    'lists:manage_all',
    'subscribers:get',
    'subscribers:get_all',
    'campaigns:get',
    'campaigns:get_analytics',
    'campaigns:manage',
    'bounces:get',
    'media:get',
    'media:manage',
    'templates:get',
    'templates:manage',
  ]) {
    assert.equal(
      LISTMONK_ROLE_PERMISSIONS.includes(permission),
      true,
      `${permission} is required by an approved tool`,
    )
  }
})

test('HTTP security rejects tool overrides and compares bearer tokens safely', async () => {
  const { hasToolOverride, isAuthorizedBearer } = await import(
    '../mcp/security.mjs'
  )

  assert.equal(
    hasToolOverride({ url: '/mcp?tools=listmonk_delete_subscriber', headers: {} }),
    true,
  )
  assert.equal(
    hasToolOverride({
      url: '/mcp',
      headers: { 'x-listmonk-enabled-tools': '' },
    }),
    true,
  )
  assert.equal(hasToolOverride({ url: '/mcp', headers: {} }), false)

  assert.equal(isAuthorizedBearer('Bearer abc123', 'abc123'), true)
  assert.equal(isAuthorizedBearer('Bearer abc124', 'abc123'), false)
  assert.equal(isAuthorizedBearer(undefined, 'abc123'), false)
})

test('custom MCP server never resolves per-request tool selectors', async () => {
  const source = await text('mcp/server.mjs')

  assert.match(source, /hasToolOverride/)
  assert.match(source, /status\(400\)/)
  assert.doesNotMatch(source, /parseEnabledToolsEnv\(overrideRaw\)/)
  assert.match(source, /registerFilteredTools\([^]*SAFE_TOOL_NAMES/)
})

test('HTTP entrypoint enforces auth, sanitizes malformed JSON, and exposes exact tools', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'listmonk-mcp-test-'))
  const store = join(dir, 'store.json')
  const port = 41_000 + (process.pid % 1_000)
  await writeFile(
    store,
    JSON.stringify({ listmonkToken: 'test-api-token', serverAuthToken: 'test-bearer' }),
    { mode: 0o600 },
  )
  const child = spawn(process.execPath, ['mcp/run.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      MCP_STORE_PATH: store,
      LISTMONK_URL: 'http://127.0.0.1:9',
      LISTMONK_API_USER: 'test-user',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const base = `http://127.0.0.1:${port}`

  try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const response = await fetch(`${base}/healthz`)
        if (response.ok) break
      } catch {}
      if (attempt === 59) throw new Error('MCP test server did not become ready')
      await new Promise((resolve) => setTimeout(resolve, 50))
    }

    let response = await postMcp(`${base}/mcp`, '{', 'wrong')
    assert.equal(response.status, 401)

    response = await postMcp(`${base}/mcp`, '{')
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: 'Malformed JSON request' })

    const initialize = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'hardening-test', version: '1.0' },
      },
    }
    response = await postMcp(`${base}/mcp?tools=`, initialize)
    assert.equal(response.status, 400)

    response = await postMcp(`${base}/mcp`, initialize)
    assert.equal(response.status, 200)

    response = await postMcp(`${base}/mcp`, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    })
    const tools = parseMcpResponse(await response.text()).result.tools
    const names = tools.map((tool) => tool.name)
    assert.equal(names.length, 32)
    assert.equal(names.includes('listmonk_update_campaign'), false)
    assert.equal(names.includes('listmonk_get_settings'), false)
    assert.equal(names.includes('listmonk_get_logs'), false)
    const create = tools.find((tool) => tool.name === 'listmonk_create_campaign')
    assert.equal('send_later' in create.inputSchema.properties, false)
    assert.equal('send_at' in create.inputSchema.properties, false)
  } finally {
    child.kill('SIGTERM')
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('MCP test server did not stop')), 3_000),
      ),
    ])
    await rm(dir, { recursive: true, force: true })
  }
})

test('MCP server and role provisioning consume one canonical policy artifact', async () => {
  const serverPolicy = await text('mcp/policy.mjs')
  const provision = await text('mcp/provision.mjs')
  const startosUtils = await text('startos/utils.ts')

  assert.match(serverPolicy, /from '.\/policy\.json'/)
  assert.match(provision, /from '.\/policy\.mjs'/)
  assert.doesNotMatch(startosUtils, /mcpEnabledTools|policy\.json/)
})

test('campaign creation cannot schedule and campaign updates are unavailable', async () => {
  const { buildHardenedTools } = await import('../mcp/hardened-tools.mjs')
  const calls = []
  const client = {}
  const makeTool = (name) => ({
    name,
    inputSchema: { send_later: {}, send_at: {}, subject: {} },
    handler: async (innerClient, args) => {
      calls.push({ forwarded: args })
      return { content: [] }
    },
  })
  const tools = buildHardenedTools([
    makeTool('listmonk_create_campaign'),
    makeTool('listmonk_update_campaign'),
    makeTool('listmonk_get_campaign'),
  ])
  const create = tools.find((tool) => tool.name === 'listmonk_create_campaign')

  assert.equal(tools.some((tool) => tool.name === 'listmonk_update_campaign'), false)
  assert.equal('send_later' in create.inputSchema, false)
  assert.equal('send_at' in create.inputSchema, false)

  await assert.rejects(
    create.handler(client, { subject: 'x', send_later: true }),
    /scheduling fields are disabled/i,
  )
  await create.handler(client, { subject: 'safe' })
  assert.deepEqual(calls.at(-1), { forwarded: { subject: 'safe' } })
})

test('credential permissions use a writable admin mount and a read-only daemon mount', async () => {
  const source = await text('startos/main.ts')

  assert.match(source, /const mcpAdminSub[^]*readonly: false/)
  assert.match(source, /const mcpSub[^]*readonly: true/)
  assert.match(source, /addOneshot\('mcp-permissions'[^]*subcontainer: mcpAdminSub/)
  assert.match(source, /addDaemon\('mcp'[^]*subcontainer: mcpSub/)
})

test('bearer rotation actions change package state without returning tokens', async () => {
  const rotate = await text('startos/actions/rotateMcpBearer.ts')
  const rollback = await text('startos/actions/rollbackMcpBearer.ts')
  const finalize = await text('startos/actions/finalizeMcpBearerRotation.ts')
  const seedFiles = await text('startos/init/seedFiles.ts')

  assert.match(rotate, /getDefaultString/)
  assert.match(rotate, /rotateMcpBearerState/)
  assert.match(rotate, /mcpStoreJson\.write/)
  assert.doesNotMatch(rotate, /value:\s*(newToken|serverAuthToken)/)
  assert.match(rotate, /restart/i)
  assert.match(rollback, /rollbackMcpBearerState/)
  assert.match(rollback, /mcpStoreJson\.write/)
  assert.match(finalize, /finalizeMcpBearerState/)
  assert.match(seedFiles, /previousServerAuthToken:\s*mcpStore\?\.previousServerAuthToken/)
  assert.doesNotMatch(`${rollback}\n${finalize}`, /value:\s*(newToken|serverAuthToken)/)
})

test('bearer rotation state machine rejects invalid transitions and serializes work', async () => {
  const {
    finalizeMcpBearerState,
    rollbackMcpBearerState,
    rotateMcpBearerState,
    withMcpBearerStateLock,
  } = await importTypeScriptModule('startos/actions/mcpBearerState.ts')
  const stable = { listmonkToken: 'internal', serverAuthToken: 'A' }
  const pending = rotateMcpBearerState(stable, 'B')

  assert.deepEqual(pending, {
    listmonkToken: 'internal',
    serverAuthToken: 'B',
    previousServerAuthToken: 'A',
  })
  assert.throws(() => rotateMcpBearerState(pending, 'C'), /already pending/i)
  assert.deepEqual(rollbackMcpBearerState(pending), stable)
  assert.deepEqual(finalizeMcpBearerState(pending), {
    listmonkToken: 'internal',
    serverAuthToken: 'B',
  })
  assert.throws(() => rollbackMcpBearerState(stable), /no.*pending/i)
  assert.throws(() => finalizeMcpBearerState(stable), /no.*pending/i)

  const order = []
  await Promise.all([
    withMcpBearerStateLock(async () => {
      order.push('first-start')
      await new Promise((resolve) => setTimeout(resolve, 20))
      order.push('first-end')
    }),
    withMcpBearerStateLock(async () => order.push('second')),
  ])
  assert.deepEqual(order, ['first-start', 'first-end', 'second'])
})

test('handoff encryption exposes ciphertext only and round-trips with the private key', async () => {
  const { encryptMcpBearer } = await importTypeScriptModule(
    'startos/actions/encryptMcpBearer.ts',
  )
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  const ciphertext = encryptMcpBearer(publicKey, 'not-a-real-secret')

  assert.doesNotMatch(ciphertext, /not-a-real-secret/)
  const plaintext = privateDecrypt(
    {
      key: privateKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    Buffer.from(ciphertext, 'base64'),
  ).toString('utf8')
  assert.equal(plaintext, 'not-a-real-secret')

  const action = await text('startos/actions/exportMcpBearerHandoff.ts')
  assert.match(action, /encryptMcpBearer/)
  assert.match(action, /withMcpBearerStateLock/)
  assert.doesNotMatch(action, /value:\s*(serverAuthToken|current\.serverAuthToken)/)
})

test('rotation and encrypted export use one serialized bearer generation', async () => {
  const { rotateMcpBearerState, withMcpBearerStateLock } =
    await importTypeScriptModule('startos/actions/mcpBearerState.ts')
  const { encryptMcpBearer } = await importTypeScriptModule(
    'startos/actions/encryptMcpBearer.ts',
  )
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  let state = { listmonkToken: 'internal', serverAuthToken: 'A' }
  let ciphertext

  await Promise.all([
    withMcpBearerStateLock(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      state = rotateMcpBearerState(state, 'B')
    }),
    withMcpBearerStateLock(async () => {
      ciphertext = encryptMcpBearer(publicKey, state.serverAuthToken)
    }),
  ])

  const exported = privateDecrypt(
    {
      key: privateKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    Buffer.from(ciphertext, 'base64'),
  ).toString('utf8')
  assert.equal(exported, 'B')
})

test('newsletter template is PNG-based and Outlook-safe', async () => {
  const html = await text('templates/owners-brief.html')

  assert.match(html, /<html[^>]+lang="en"/i)
  assert.match(html, /src="https:\/\/www\.freeholdagents\.ai\/apple-icon"/i)
  assert.doesNotMatch(html, /\.svg/i)
  assert.match(html, /width="40"/i)
  assert.match(html, /height="40"/i)
  assert.match(html, /role="presentation"/i)
  assert.match(html, /<!--\[if mso\]>/i)
  assert.match(html, /class="preheader"/i)
  assert.match(html, /200 S 21st St\., STE 400A, Lincoln, NE 68510/)
  assert.match(html, /{{ UnsubscribeURL }}/)
  assert.match(html, /{{ MessageURL }}/)
  assert.match(html, /{{ TrackView }}/)
})

test('template acceptance probe compiles the packaged body through Listmonk', async () => {
  const source = await text('scripts/verify-template-preview.mjs')

  assert.match(source, /templates\/owners-brief\.html/)
  assert.match(source, /\/api\/templates\/preview/)
  assert.match(source, /application\/x-www-form-urlencoded/)
  assert.doesNotMatch(source, /console\.log\([^)]*body/)
})

test('credential runbook requires ownership, runtime readability, and rollback checks', async () => {
  const runbook = await text('docs/hermes-listmonk-credential-runbook.md')
  const policy = JSON.parse(await text('mcp/policy.json'))

  assert.match(runbook, /install -o hermes -g hermes -m 600/)
  assert.match(runbook, /runuser -u hermes -- test -r \/opt\/data\/\.env/)
  assert.match(runbook, /rollback/i)
  assert.match(runbook, /do not restart Hermes from the active gateway turn/i)
  assert.match(runbook, /never print/i)
  assert.match(runbook, /rotate-mcp-bearer/)
  assert.match(runbook, /nonempty|non-empty/i)
  assert.match(runbook, /timestamp/i)
  assert.doesNotMatch(runbook, /config\.yaml\.pre-listmonk\n/)
  assert.match(runbook, /Export Encrypted MCP Bearer/)
  assert.match(runbook, /RSA-OAEP/)
  assert.match(runbook, /trap cleanup EXIT/)
  assert.match(runbook, /For rotations only[^]*finalize-mcp-bearer-rotation/i)

  const includeBlock = runbook.match(/tools:\n\s+include:\n((?:\s+- listmonk_[^\n]+\n?)+)/)
  assert.ok(includeBlock, 'runbook must contain the canonical Hermes tool include list')
  const documentedTools = [...includeBlock[1].matchAll(/- (listmonk_[^\s]+)/g)].map(
    (match) => match[1],
  )
  assert.deepEqual(documentedTools, policy.safeToolNames)
})

test('custom server declares its directly imported dependencies', async () => {
  const pkg = JSON.parse(await text('mcp/package.json'))

  assert.equal(pkg.dependencies['@modelcontextprotocol/sdk'], '1.30.1')
  assert.equal(pkg.dependencies.express, '4.22.3')
})
