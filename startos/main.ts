import { storeJson } from './fileModels/store.json'
import { i18n } from './i18n'
import { sdk } from './sdk'
import {
  mcpApiUsername,
  mcpEnabledTools,
  mcpMountpoint,
  mcpPort,
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
  if (!store?.postgresPassword) {
    throw new Error('store.json is missing the generated database password')
  }
  const { postgresPassword } = store

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

  const mcpSub = await sdk.SubContainer.of(
    effects,
    { imageId: 'mcp' },
    sdk.Mounts.of().mountVolume({
      volumeId: 'mcp',
      subpath: null,
      mountpoint: mcpMountpoint,
      readonly: true,
    }),
    'mcp-sub',
  )

  // Same lifecycle as upstream's docker-compose.yml, split into StartOS
  // oneshots so the MCP API user exists before Listmonk loads its auth cache:
  //   --install --idempotent  creates the schema on an empty database. With
  //                           no LISTMONK_ADMIN_* variables, Listmonk shows
  //                           its own first-run account setup page.
  //   --upgrade               runs DB migrations after an image update.
  // --config '' makes Listmonk read file-based config from LISTMONK_* env
  // vars only; settings changed in the UI still live in PostgreSQL.
  const listmonkInstallCmd = [
    './listmonk --install --idempotent --yes --config ""',
    './listmonk --upgrade --yes --config ""',
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
    .addOneshot('listmonk-install', {
      subcontainer: listmonkSub,
      exec: {
        command: sdk.useEntrypoint(['sh', '-c', listmonkInstallCmd]),
        cwd: '/listmonk',
        env: {
          LISTMONK_app__address: `0.0.0.0:${uiPort}`,
          LISTMONK_db__host: '127.0.0.1',
          LISTMONK_db__port: String(postgresPort),
          LISTMONK_db__user: postgresUser,
          LISTMONK_db__password: postgresPassword,
          LISTMONK_db__database: postgresDb,
          LISTMONK_db__ssl_mode: 'disable',
        },
      },
      requires: ['postgres'],
    })
    .addOneshot('mcp-permissions', {
      subcontainer: mcpSub,
      exec: {
        command: [
          'sh',
          '-c',
          `chown node:node ${mcpMountpoint}/store.json && chmod 600 ${mcpMountpoint}/store.json`,
        ],
        user: 'root',
      },
      requires: ['listmonk-install'],
    })
    .addOneshot('mcp-provision', {
      subcontainer: mcpSub,
      exec: {
        command: ['node', 'provision.mjs'],
        cwd: '/opt/listmonk-mcp',
        user: 'node',
        env: {
          MCP_STORE_PATH: `${mcpMountpoint}/store.json`,
          POSTGRES_HOST: '127.0.0.1',
          POSTGRES_PORT: String(postgresPort),
          POSTGRES_USER: postgresUser,
          POSTGRES_PASSWORD: postgresPassword,
          POSTGRES_DB: postgresDb,
        },
      },
      requires: ['mcp-permissions'],
    })
    .addDaemon('listmonk', {
      subcontainer: listmonkSub,
      exec: {
        command: sdk.useEntrypoint(['sh', '-c', 'exec ./listmonk --config ""']),
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
      requires: ['mcp-provision'],
    })
    .addDaemon('mcp', {
      subcontainer: mcpSub,
      exec: {
        command: sdk.useEntrypoint(),
        cwd: '/opt/listmonk-mcp',
        user: 'node',
        env: {
          MCP_STORE_PATH: `${mcpMountpoint}/store.json`,
          LISTMONK_URL: `http://127.0.0.1:${uiPort}`,
          LISTMONK_API_USER: mcpApiUsername,
          LISTMONK_ENABLED_TOOLS: JSON.stringify(mcpEnabledTools),
          PORT: String(mcpPort),
        },
      },
      ready: {
        display: i18n('MCP'),
        gracePeriod: 5_000,
        fn: () =>
          sdk.healthCheck.checkWebUrl(
            effects,
            `http://127.0.0.1:${mcpPort}/healthz`,
            {
              successMessage: i18n('The MCP server is ready'),
              errorMessage: i18n('The MCP server is not ready'),
            },
          ),
      },
      requires: ['listmonk'],
    })
})
