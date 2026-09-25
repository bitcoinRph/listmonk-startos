import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import express from 'express'
import { loadConfig } from './node_modules/@kieksme/listmonk-mcp/dist/config.js'
import {
  assertUniqueToolNames,
  registerFilteredTools,
} from './node_modules/@kieksme/listmonk-mcp/dist/registry/toolRegistry.js'
import { ListmonkClient } from './node_modules/@kieksme/listmonk-mcp/dist/services/listmonkClient.js'
import { ALL_TOOLS } from './node_modules/@kieksme/listmonk-mcp/dist/tools/index.js'
import { buildHardenedTools } from './hardened-tools.mjs'
import { SAFE_TOOL_NAMES } from './policy.mjs'
import { hasToolOverride, isAuthorizedBearer } from './security.mjs'

const SERVER_NAME = 'listmonk-startos-mcp'
const SERVER_VERSION = '1.2.0'

const HARDENED_TOOLS = buildHardenedTools(ALL_TOOLS)
assertUniqueToolNames(HARDENED_TOOLS)

const allToolNames = new Set(HARDENED_TOOLS.map((tool) => tool.name))
for (const name of SAFE_TOOL_NAMES) {
  if (!allToolNames.has(name)) {
    throw new Error(`Configured safe MCP tool is missing from the pinned dependency: ${name}`)
  }
}

const config = loadConfig()
if (!config.serverAuthToken) {
  throw new Error('MCP_SERVER_AUTH_TOKEN is required')
}

const safeToolNames = new Set(SAFE_TOOL_NAMES)
const listmonkClient = new ListmonkClient({
  baseUrl: config.listmonkUrl,
  apiUser: config.listmonkApiUser,
  apiToken: config.listmonkApiToken,
})

const app = express()
const activeResources = new Set()
app.disable('x-powered-by')
const parseJson = express.json({ limit: '1mb' })

async function closeResources(resource) {
  if (!activeResources.delete(resource)) return
  await Promise.allSettled([resource.transport.close(), resource.server.close()])
}

app.post('/mcp', (req, res, next) => {
  if (!isAuthorizedBearer(req.header('authorization'), config.serverAuthToken)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  if (hasToolOverride(req)) {
    res.status(400).json({ error: 'Per-request tool overrides are disabled' })
    return
  }

  parseJson(req, res, next)
})

app.post('/mcp', async (req, res) => {
  let resource
  try {
    const server = new McpServer(
      { name: SERVER_NAME, version: SERVER_VERSION },
      { capabilities: { tools: {} } },
    )
    registerFilteredTools(server, listmonkClient, HARDENED_TOOLS, safeToolNames)

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    resource = { server, transport }
    activeResources.add(resource)
    res.on('close', () => void closeResources(resource))
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  } catch (error) {
    console.error('Error handling /mcp request:', error)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' })
    }
  } finally {
    if (resource && res.writableEnded) await closeResources(resource)
  }
})

app.use((error, _req, res, _next) => {
  if (error instanceof SyntaxError) {
    res.status(400).json({ error: 'Malformed JSON request' })
    return
  }
  console.error('MCP HTTP middleware error:', error)
  res.status(500).json({ error: 'Internal server error' })
})

app.get('/mcp', (_req, res) => {
  res
    .status(405)
    .json({ error: 'Method not allowed. This server runs in stateless mode; use POST /mcp.' })
})

app.delete('/mcp', (_req, res) => {
  res
    .status(405)
    .json({ error: 'Method not allowed. This server runs in stateless mode; use POST /mcp.' })
})

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', tools: SAFE_TOOL_NAMES.length })
})

const httpServer = app.listen(config.port, () => {
  console.error(`${SERVER_NAME} v${SERVER_VERSION} listening on port ${config.port}`)
  console.error(`Listmonk instance: ${config.listmonkUrl}`)
  console.error(`Enabled tools: ${SAFE_TOOL_NAMES.length} exact names; overrides disabled`)
})

httpServer.on('error', (error) => {
  console.error('MCP HTTP server error:', error)
})

let shuttingDown = false
async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.error(`Received ${signal}; shutting down`)
  const closed = new Promise((resolve) => httpServer.close(resolve))
  await Promise.allSettled([...activeResources].map(closeResources))
  httpServer.closeAllConnections?.()
  await closed
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void shutdown(signal).then(
      () => process.exit(0),
      (error) => {
        console.error('MCP shutdown failed:', error)
        process.exit(1)
      },
    )
  })
}
