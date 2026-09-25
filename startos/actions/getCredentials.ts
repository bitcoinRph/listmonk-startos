import { storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'
import { adminUser } from '../utils'

export const getCredentials = sdk.Action.withoutInput(
  'get-credentials',

  async () => ({
    name: i18n('Get Admin Credentials'),
    description: i18n(
      'Show the admin username and the password listmonk was set up with',
    ),
    warning: null,
    allowedStatuses: 'any',
    group: null,
    visibility: 'enabled',
  }),

  async () => {
    const password = await storeJson.read((s) => s.adminPassword).once()

    return {
      version: '1',
      title: i18n('listmonk Admin Credentials'),
      message: i18n(
        'Log in at /admin on the Web UI address. This is the password listmonk was set up with. If you changed it inside listmonk, use your new password instead.',
      ),
      result: {
        type: 'group',
        value: [
          {
            type: 'single',
            name: i18n('Username'),
            description: null,
            value: adminUser,
            masked: false,
            copyable: true,
            qr: false,
          },
          {
            type: 'single',
            name: i18n('Password'),
            description: null,
            value: password ?? 'UNKNOWN',
            masked: true,
            copyable: true,
            qr: false,
          },
        ],
      },
    }
  },
)
