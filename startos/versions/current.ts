import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '6.2.0:7',
  releaseNotes: {
    en_US:
      'Security update for the MCP server: updates follow-redirects to 1.16.3 and @hono/node-server to 2.1.6 to fix published advisories. No change to listmonk, settings or data.',
  },
  migrations: {
    up: async () => {},
    down: IMPOSSIBLE,
  },
})
