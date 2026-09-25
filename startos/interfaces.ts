import { i18n } from './i18n'
import { sdk } from './sdk'
import { mcpHostId, mcpPort, uiPort } from './utils'

export const uiHostId = 'main'
export const uiInterfaceId = 'ui'
export const apiInterfaceId = 'api'
export const mcpInterfaceId = 'mcp'

// One interface serves both the admin dashboard (/admin) and the public
// pages subscribers see (subscription forms, opt-in confirmation,
// unsubscribe, archive). Subscribers need the public pages, so this is the
// address to give a public domain.
export const setInterfaces = sdk.setupInterfaces(async ({ effects }) => {
  const multi = sdk.MultiHost.of(effects, uiHostId)
  const origin = await multi.bindPort(uiPort, { protocol: 'http' })
  const ui = sdk.createInterface(effects, {
    name: i18n('Web UI'),
    id: uiInterfaceId,
    description: i18n(
      'The listmonk admin dashboard at /admin, plus the public subscription, opt-in, and unsubscribe pages',
    ),
    type: 'ui',
    masked: false,
    schemeOverride: null,
    username: null,
    path: '',
    query: {},
  })
  const api = sdk.createInterface(effects, {
    name: i18n('REST API'),
    id: apiInterfaceId,
    description: i18n(
      'Authenticated Listmonk API for lists, subscribers, campaigns, templates, media, settings, and reporting',
    ),
    type: 'api',
    masked: false,
    schemeOverride: null,
    username: null,
    path: '/api',
    query: {},
  })

  const mcpHost = sdk.MultiHost.of(effects, mcpHostId)
  const mcpOrigin = await mcpHost.bindPort(mcpPort, {
    protocol: 'http',
    preferredExternalPort: mcpPort,
  })
  const mcp = sdk.createInterface(effects, {
    name: i18n('MCP'),
    id: mcpInterfaceId,
    description: i18n(
      'Bearer-protected Streamable HTTP endpoint that exposes Listmonk operations as agent tools',
    ),
    type: 'api',
    masked: false,
    schemeOverride: null,
    username: null,
    path: '/mcp',
    query: {},
  })

  return [await origin.export([ui, api]), await mcpOrigin.export([mcp])]
})
