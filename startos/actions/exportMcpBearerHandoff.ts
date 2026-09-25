import { mcpStoreJson } from '../fileModels/mcp-store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'
import { encryptMcpBearer } from './encryptMcpBearer'
import { withMcpBearerStateLock } from './mcpBearerState'

const { InputSpec, Value } = sdk

const inputSpec = InputSpec.of({
  publicKeyPem: Value.textarea({
    name: i18n('One-Time RSA Public Key'),
    description: i18n(
      'Paste the PEM public key generated inside the destination Hermes package. The private key must never leave Hermes.',
    ),
    default: null,
    required: true,
    minLength: 200,
    maxLength: 10_000,
    minRows: 8,
    maxRows: 14,
    placeholder: '-----BEGIN PUBLIC KEY-----',
  }),
})

export const exportMcpBearerHandoff = sdk.Action.withInput(
  'export-mcp-bearer-handoff',
  async () => ({
    name: i18n('Export Encrypted MCP Bearer'),
    description: i18n(
      'Encrypt the current Hermes-facing MCP bearer to a one-time RSA public key',
    ),
    warning: i18n(
      'Only ciphertext is returned. Keep the matching private key inside Hermes and delete the handoff artifacts after verification.',
    ),
    allowedStatuses: 'any',
    group: null,
    visibility: 'enabled',
  }),
  inputSpec,
  async () => ({ publicKeyPem: undefined }),
  async ({ input }) =>
    withMcpBearerStateLock(async () => {
      const current = await mcpStoreJson.read().once()
      if (!current?.serverAuthToken) {
        throw new Error('MCP credential store is incomplete')
      }
      const ciphertext = encryptMcpBearer(
        input.publicKeyPem,
        current.serverAuthToken,
      )
      return {
        version: '1' as const,
        title: i18n('Encrypted MCP Bearer'),
        message: i18n(
          'Decrypt this ciphertext only inside the destination Hermes package. No plaintext credential was returned.',
        ),
        result: {
          type: 'single' as const,
          name: i18n('RSA-OAEP Ciphertext'),
          description: i18n('Base64 ciphertext using RSA-OAEP with SHA-256'),
          value: ciphertext,
          masked: false,
          copyable: true,
          qr: false,
        },
      }
    }),
)
