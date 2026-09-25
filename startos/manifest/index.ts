import { setupManifest } from '@start9labs/start-sdk'
import { long, short } from './i18n'

export const manifest = setupManifest({
  id: 'listmonk',
  title: 'listmonk',
  license: 'AGPL-3.0',
  packageRepo: 'https://github.com/bitcoinRph/listmonk-startos',
  upstreamRepo: 'https://github.com/knadh/listmonk',
  marketingUrl: 'https://listmonk.app',
  donationUrl: null,
  description: { short, long },
  volumes: ['main', 'db'],
  images: {
    listmonk: {
      source: { dockerTag: 'listmonk/listmonk:v6.2.0' },
      arch: ['x86_64', 'aarch64'],
    },
    postgres: {
      source: { dockerTag: 'postgres:17-alpine' },
      arch: ['x86_64', 'aarch64'],
    },
  },
  dependencies: {},
})
