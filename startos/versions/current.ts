import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '6.2.0:6',
  releaseNotes: {
    en_US:
      'Security update for the MCP server: updates @modelcontextprotocol/sdk to 1.32.2 and body-parser to 2.4.0 and 1.20.9 to fix published advisories. No change to listmonk, settings or data.',
  },
  migrations: {
    up: async () => {},
    down: IMPOSSIBLE,
  },
})
