import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '6.2.0:4',
  releaseNotes: {
    en_US:
      'Hardens the MCP boundary with exact server-side tools, least-privilege Listmonk permissions, blocked tool overrides, and a documented credential-transfer preflight.',
  },
  migrations: {
    up: async () => {},
    down: IMPOSSIBLE,
  },
})
