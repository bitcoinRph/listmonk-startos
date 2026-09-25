import { mcpStoreJson } from '../fileModels/mcp-store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'
import {
  finalizeMcpBearerState,
  withMcpBearerStateLock,
} from './mcpBearerState'

export const finalizeMcpBearerRotation = sdk.Action.withoutInput(
  'finalize-mcp-bearer-rotation',
  async () => ({
    name: i18n('Finalize MCP Bearer Rotation'),
    description: i18n(
      'Remove the retained rollback bearer after the new bearer is verified',
    ),
    warning: i18n(
      'Do not finalize until Hermes authenticates with the new bearer and the previous bearer is confirmed rejected.',
    ),
    allowedStatuses: 'any',
    group: null,
    visibility: 'enabled',
  }),
  async ({ effects }) =>
    withMcpBearerStateLock(async () => {
      const current = (await mcpStoreJson.read().once()) ?? {}
      await mcpStoreJson.write(effects, finalizeMcpBearerState(current))

      return {
        version: '1' as const,
        title: i18n('MCP Bearer Rotation Finalized'),
        message: i18n(
          'The retained rollback bearer was removed from current package state. No credential was displayed.',
        ),
        result: {
          type: 'single' as const,
          name: i18n('Status'),
          description: null,
          value: i18n('Rotation finalized'),
          masked: false,
          copyable: false,
          qr: false,
        },
      }
    }),
)
