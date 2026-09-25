import policy from './policy.json' with { type: 'json' }

export const SAFE_TOOL_NAMES = Object.freeze([...policy.safeToolNames])
export const LISTMONK_ROLE_PERMISSIONS = Object.freeze([
  ...policy.listmonkRolePermissions,
])
