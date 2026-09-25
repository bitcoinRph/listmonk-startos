import { utils } from '@start9labs/start-sdk'
import { mcpStoreJson } from '../fileModels/mcp-store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'
import { rotateMcpBearerState, withMcpBearerStateLock } from './mcpBearerState'

export const rotateMcpBearer = sdk.Action.withoutInput(
  'rotate-mcp-bearer',
  async () => ({
    name: i18n('Rotate MCP Bearer'),
    description: i18n(
      'Generate a new MCP client bearer without displaying or logging it',
    ),
    warning: i18n(
      'Hermes must receive the new bearer through the protected encrypted handoff before Listmonk is restarted.',
    ),
    allowedStatuses: 'any',
    group: null,
    visibility: 'enabled',
  }),
  async ({ effects }) =>
    withMcpBearerStateLock(async () => {
      const current = (await mcpStoreJson.read().once()) ?? {}
      const next = rotateMcpBearerState(
        current,
        utils.getDefaultString({
          charset: 'a-z,A-Z,0-9',
          len: 48,
        }),
      )
      await mcpStoreJson.write(effects, next)

      return {
        version: '1' as const,
        title: i18n('MCP Bearer Rotated'),
        message: i18n(
          'The new bearer is stored but was not displayed. Transfer it through the protected encrypted handoff, then restart Listmonk. The prior bearer remains available to the rollback action.',
        ),
        result: {
          type: 'single' as const,
          name: i18n('Next Step'),
          description: null,
          value: i18n('Protected transfer and restart required'),
          masked: false,
          copyable: false,
          qr: false,
        },
      }
    }),
)
