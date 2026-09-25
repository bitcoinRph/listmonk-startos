import { mcpStoreJson } from '../fileModels/mcp-store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'
import {
  rollbackMcpBearerState,
  withMcpBearerStateLock,
} from './mcpBearerState'

export const rollbackMcpBearer = sdk.Action.withoutInput(
  'rollback-mcp-bearer',
  async () => ({
    name: i18n('Rollback MCP Bearer'),
    description: i18n(
      'Swap the current and previous MCP client bearers without displaying either value',
    ),
    warning: i18n(
      'Use only during a failed rotation. Hermes and Listmonk must be returned to the same bearer before restart.',
    ),
    allowedStatuses: 'any',
    group: null,
    visibility: 'enabled',
  }),
  async ({ effects }) =>
    withMcpBearerStateLock(async () => {
      const current = (await mcpStoreJson.read().once()) ?? {}
      await mcpStoreJson.write(effects, rollbackMcpBearerState(current))

      return {
        version: '1' as const,
        title: i18n('MCP Bearer Rolled Back'),
        message: i18n(
          'The prior bearer is active in package state and was not displayed. Restore the matching protected Hermes configuration before restarting services.',
        ),
        result: {
          type: 'single' as const,
          name: i18n('Next Step'),
          description: null,
          value: i18n('Restore matching Hermes configuration before restart'),
          masked: false,
          copyable: false,
          qr: false,
        },
      }
    }),
)
