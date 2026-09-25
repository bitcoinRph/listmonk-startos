import { FileHelper, z } from '@start9labs/start-sdk'
import { sdk } from '../sdk'

const shape = z.object({
  listmonkToken: z.string().optional().catch(undefined),
  serverAuthToken: z.string().optional().catch(undefined),
  previousServerAuthToken: z.string().optional().catch(undefined),
})

export const mcpStoreJson = FileHelper.json(
  { base: sdk.volumes.mcp, subpath: 'store.json' },
  shape,
)
