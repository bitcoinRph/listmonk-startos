import { readFile } from 'node:fs/promises'

const storePath = process.env.MCP_STORE_PATH ?? '/startos-mcp/store.json'
const store = JSON.parse(await readFile(storePath, 'utf8'))

if (!store.listmonkToken || !store.serverAuthToken) {
  throw new Error('MCP credential store is incomplete')
}

process.env.LISTMONK_URL = process.env.LISTMONK_URL ?? 'http://127.0.0.1:9000'
process.env.LISTMONK_API_USER = process.env.LISTMONK_API_USER ?? 'startos-mcp'
process.env.LISTMONK_API_TOKEN = store.listmonkToken
process.env.MCP_SERVER_AUTH_TOKEN = store.serverAuthToken
process.env.PORT = process.env.PORT ?? '3000'

await import('./server.mjs')
