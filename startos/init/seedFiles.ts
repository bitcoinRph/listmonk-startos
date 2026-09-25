import { utils } from '@start9labs/start-sdk'
import { mcpStoreJson } from '../fileModels/mcp-store.json'
import { storeJson } from '../fileModels/store.json'
import { sdk } from '../sdk'

export const seedFiles = sdk.setupOnInit(async (effects, kind) => {
  if (kind === 'install') {
    await storeJson.write(effects, {
      postgresPassword: utils.getDefaultString({
        charset: 'a-z,A-Z,0-9',
        len: 32,
      }),
    })
  } else {
    // Heal missing keys on update/restore without touching existing values.
    await storeJson.merge(effects, {})
  }

  const mcpStore = await mcpStoreJson.read().once()
  await mcpStoreJson.write(effects, {
    listmonkToken:
      mcpStore?.listmonkToken ??
      utils.getDefaultString({ charset: 'a-z,A-Z,0-9', len: 48 }),
    serverAuthToken:
      mcpStore?.serverAuthToken ??
      utils.getDefaultString({ charset: 'a-z,A-Z,0-9', len: 48 }),
  })
})
