import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '6.2.0:8',
  releaseNotes: {
    en_US:
      'Security update for the MCP server: updates hono to 4.13.23 to fix published advisories, and pg to 8.23.1. No change to listmonk, settings or data.',
  },
  migrations: {
    up: async () => {},
    down: IMPOSSIBLE,
  },
})
