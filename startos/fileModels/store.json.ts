import { FileHelper, z } from '@start9labs/start-sdk'
import { sdk } from '../sdk'

// Package-owned state. Lives at the root of the main volume, outside the
// uploads/ subpath listmonk serves, so secrets are never publicly reachable.
const shape = z.object({
  postgresPassword: z.string().optional().catch(undefined),
  // The password the admin user was created with on first start. listmonk
  // stores its own hash after that, so changing the password inside the
  // listmonk UI makes this value stale; Get Credentials says so.
  adminPassword: z.string().optional().catch(undefined),
})

export const storeJson = FileHelper.json(
  { base: sdk.volumes.main, subpath: 'store.json' },
  shape,
)
