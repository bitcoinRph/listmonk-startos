// Constants shared across the package codebase.

// listmonk's HTTP port inside the container (LISTMONK_app__address).
export const uiPort = 9000

// Streamable HTTP MCP sidecar.
export const mcpHostId = 'mcp'
export const mcpPort = 3000
export const mcpMountpoint = '/startos-mcp'
export const mcpApiUsername = 'startos-mcp'
export const mcpEnabledTools = [
  'subscribers',
  'campaigns',
  'templates',
  'lists',
  'media',
  'import',
  'bounces',
  'logs',
  'public',
  'miscellaneous',
  'listmonk_get_settings',
]

// Bundled PostgreSQL. Listens on 127.0.0.1 only; never exposed as an interface.
export const postgresUser = 'listmonk' as const
export const postgresDb = 'listmonk' as const
export const postgresPort = 5432

// Where uploaded media lives in the listmonk container. Upstream's default
// media path is ./uploads relative to /listmonk.
export const uploadsDir = '/listmonk/uploads'

// Postgres volume layout (matches postgres:17 PGDATA=/var/lib/postgresql/data).
export const pgMountpoint = '/var/lib/postgresql'
export const pgDataSubpath = '/data'
