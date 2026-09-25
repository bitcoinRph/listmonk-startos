import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '6.2.0:3',
  releaseNotes: {
    en_US:
      'Adds a labeled REST API interface and a bearer-protected Streamable HTTP MCP server backed by a dedicated internal Listmonk API user.',
  },
  migrations: {
    up: async () => {},
    down: IMPOSSIBLE,
  },
})
