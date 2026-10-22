import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '6.2.0:5',
  releaseNotes: {
    en_US:
      'Prevents the MCP API user from receiving Listmonk’s reserved superadmin role on first run, repairs affected package-created roles on startup, and gates CI packaging on tests.',
  },
  migrations: {
    up: async () => {},
    down: IMPOSSIBLE,
  },
})
