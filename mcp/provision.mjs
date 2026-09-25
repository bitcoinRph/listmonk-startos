import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'

const { Client } = pg
const storePath = process.env.MCP_STORE_PATH ?? '/startos-mcp/store.json'
const store = JSON.parse(await readFile(storePath, 'utf8'))

if (!store.listmonkToken) {
  throw new Error('MCP credential store is missing the Listmonk API token')
}
if (!process.env.POSTGRES_PASSWORD) {
  throw new Error('POSTGRES_PASSWORD is required')
}

const client = new Client({
  host: process.env.POSTGRES_HOST ?? '127.0.0.1',
  port: Number.parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
  user: process.env.POSTGRES_USER ?? 'listmonk',
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB ?? 'listmonk',
})

await client.connect()
try {
  const tokenHash = createHash('sha256')
    .update(store.listmonkToken)
    .digest('hex')
  const permissions = [
    'lists:get_all',
    'lists:manage_all',
    'subscribers:get',
    'subscribers:get_all',
    'subscribers:manage',
    'subscribers:import',
    'campaigns:get',
    'campaigns:get_all',
    'campaigns:get_analytics',
    'campaigns:manage',
    'campaigns:manage_all',
    'campaigns:send',
    'bounces:get',
    'bounces:manage',
    'media:get',
    'media:manage',
    'templates:get',
    'templates:manage',
    'settings:get',
  ]

  await client.query('BEGIN')
  const role = await client.query(
    `INSERT INTO roles (type, name, permissions)
     VALUES ('user', $1, $2::text[])
     ON CONFLICT (type, name) WHERE name IS NOT NULL DO UPDATE SET
       permissions = EXCLUDED.permissions,
       updated_at = NOW()
     RETURNING id`,
    ['StartOS MCP', permissions],
  )

  await client.query(
    `INSERT INTO users
      (username, password_login, password, email, name, type, user_role_id, list_role_id, status)
     VALUES ($1, false, $2, $3, $4, 'api', $5, NULL, 'enabled')
     ON CONFLICT (username) DO UPDATE SET
       password_login = false,
       password = EXCLUDED.password,
       email = EXCLUDED.email,
       name = EXCLUDED.name,
       type = 'api',
       user_role_id = EXCLUDED.user_role_id,
       list_role_id = NULL,
       status = 'enabled',
       updated_at = NOW()`,
    [
      'startos-mcp',
      tokenHash,
      'startos-mcp@api',
      'StartOS MCP',
      role.rows[0].id,
    ],
  )
  await client.query('COMMIT')
  console.log('Listmonk MCP API user is ready')
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  await client.end()
}
