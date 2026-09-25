import { storeJson } from './fileModels/store.json'
import { i18n } from './i18n'
import { sdk } from './sdk'
import {
  adminUser,
  pgMountpoint,
  postgresDb,
  postgresPort,
  postgresUser,
  uiPort,
  uploadsDir,
} from './utils'

export const main = sdk.setupMain(async ({ effects }) => {
  console.info(i18n('Starting listmonk'))

  const store = await storeJson.read().const(effects)
  if (!store?.postgresPassword || !store.adminPassword) {
    throw new Error('store.json is missing generated credentials')
  }
  const { postgresPassword, adminPassword } = store

  const postgresSub = await sdk.SubContainer.of(
    effects,
    { imageId: 'postgres' },
    sdk.Mounts.of().mountVolume({
      volumeId: 'db',
      subpath: null,
      mountpoint: pgMountpoint,
      readonly: false,
    }),
    'postgres-sub',
  )

  const listmonkSub = await sdk.SubContainer.of(
    effects,
    { imageId: 'listmonk' },
    sdk.Mounts.of().mountVolume({
      volumeId: 'main',
      subpath: 'uploads',
      mountpoint: uploadsDir,
      readonly: false,
    }),
    'listmonk-sub',
  )

  // Same startup sequence as upstream's docker-compose.yml:
  //   --install --idempotent  creates the schema (and the admin user from
  //                           LISTMONK_ADMIN_*) only on an empty database
  //   --upgrade               runs DB migrations after an image update
  // --config '' makes listmonk read config from LISTMONK_* env vars only.
  const listmonkCmd = [
    './listmonk --install --idempotent --yes --config ""',
    './listmonk --upgrade --yes --config ""',
    'exec ./listmonk --config ""',
  ].join(' && ')

  return sdk.Daemons.of(effects)
    .addDaemon('postgres', {
      subcontainer: postgresSub,
      exec: {
        command: sdk.useEntrypoint(['-c', 'listen_addresses=127.0.0.1']),
        env: {
          POSTGRES_USER: postgresUser,
          POSTGRES_PASSWORD: postgresPassword,
          POSTGRES_DB: postgresDb,
        },
      },
      ready: {
        display: i18n('Database'),
        fn: async () => {
          const { exitCode } = await postgresSub.exec([
            'pg_isready',
            '-U',
            postgresUser,
            '-d',
            postgresDb,
            '-h',
            '127.0.0.1',
          ])
          return exitCode === 0
            ? { result: 'success' as const, message: null }
            : {
                result: 'loading' as const,
                message: i18n('Initializing PostgreSQL'),
              }
        },
      },
      requires: [],
    })
    .addDaemon('listmonk', {
      subcontainer: listmonkSub,
      exec: {
        command: sdk.useEntrypoint(['sh', '-c', listmonkCmd]),
        cwd: '/listmonk',
        env: {
          LISTMONK_app__address: `0.0.0.0:${uiPort}`,
          LISTMONK_db__host: '127.0.0.1',
          LISTMONK_db__port: String(postgresPort),
          LISTMONK_db__user: postgresUser,
          LISTMONK_db__password: postgresPassword,
          LISTMONK_db__database: postgresDb,
          LISTMONK_db__ssl_mode: 'disable',
          LISTMONK_db__max_open: '25',
          LISTMONK_db__max_idle: '25',
          LISTMONK_db__max_lifetime: '300s',
          LISTMONK_ADMIN_USER: adminUser,
          LISTMONK_ADMIN_PASSWORD: adminPassword,
          TZ: 'Etc/UTC',
        },
      },
      ready: {
        display: i18n('Web Interface'),
        gracePeriod: 30000,
        fn: () =>
          sdk.healthCheck.checkWebUrl(
            effects,
            `http://127.0.0.1:${uiPort}/admin`,
            {
              successMessage: i18n('The web interface is ready'),
              errorMessage: i18n('The web interface is not ready'),
            },
          ),
      },
      requires: ['postgres'],
    })
})
