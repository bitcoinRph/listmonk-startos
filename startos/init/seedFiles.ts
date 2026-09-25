import { utils } from '@start9labs/start-sdk'
import { getCredentials } from '../actions/getCredentials'
import { storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'

export const seedFiles = sdk.setupOnInit(async (effects, kind) => {
  if (kind === 'install') {
    await storeJson.write(effects, {
      postgresPassword: utils.getDefaultString({
        charset: 'a-z,A-Z,0-9',
        len: 32,
      }),
      adminPassword: utils.getDefaultString({
        charset: 'a-z,A-Z,0-9',
        len: 24,
      }),
    })
  } else {
    // Heal missing keys on update/restore without touching existing values.
    await storeJson.merge(effects, {})
  }

  if (kind === 'install' || kind === 'restore') {
    await sdk.action.createOwnTask(effects, getCredentials, 'critical', {
      reason: i18n('Retrieve your listmonk admin login'),
    })
  }
})
