import { FileHelper, z } from '@start9labs/start-sdk'
import { sdk } from '../sdk'

// Package-owned state. Lives at the root of the main volume, outside the
// uploads/ subpath listmonk serves, so the database password is never publicly
// reachable.
const shape = z.object({
  postgresPassword: z.string().optional().catch(undefined),
})

export const storeJson = FileHelper.json(
  { base: sdk.volumes.main, subpath: 'store.json' },
  shape,
)
