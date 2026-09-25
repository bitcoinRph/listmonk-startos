import { i18n } from './i18n'
import { sdk } from './sdk'
import { uiPort } from './utils'

export const uiHostId = 'main'
export const uiInterfaceId = 'ui'

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
  return [await origin.export([ui])]
})
