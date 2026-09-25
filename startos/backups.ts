import { storeJson } from './fileModels/store.json'
import { sdk } from './sdk'
import { pgDataSubpath, pgMountpoint, postgresDb, postgresUser } from './utils'

// The database is backed up as a pg_dump rather than raw files, so a backup
// taken while listmonk is running is consistent. The main volume carries
// the database secret and uploaded media. The mcp volume carries the
// internal Listmonk API token and the client-facing MCP bearer token.
export const { createBackup, restoreInit } = sdk.setupBackups(async () =>
  sdk.Backups.withPgDump({
    imageId: 'postgres',
    dbVolume: 'db',
    mountpoint: pgMountpoint,
    pgdataPath: pgDataSubpath,
    database: postgresDb,
    user: postgresUser,
    password: async () => {
      const pw = await storeJson.read((s) => s.postgresPassword).once()
      if (!pw) throw new Error('store.json is missing the database password')
      return pw
    },
  })
    .addVolume('main')
    .addVolume('mcp'),
)
