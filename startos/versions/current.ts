import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '6.2.0:1',
  releaseNotes: {
    en_US:
      'Initial StartOS release of listmonk 6.2.0 with a bundled PostgreSQL 17 database. Revision 1 uses Listmonk’s own first-run account setup so admin credentials never pass through StartOS action logs.',
  },
  migrations: {
    up: async () => {},
    down: IMPOSSIBLE,
  },
})
