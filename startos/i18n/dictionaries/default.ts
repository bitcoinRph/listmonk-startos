export const DEFAULT_LANG = 'en_US'

const dict = {
  'Starting listmonk': 0,
  Database: 1,
  'Initializing PostgreSQL': 2,
  'Web Interface': 3,
  'The web interface is ready': 4,
  'The web interface is not ready': 5,
  'Web UI': 6,
  'The listmonk admin dashboard at /admin, plus the public subscription, opt-in, and unsubscribe pages': 7,
  'REST API': 8,
  'Authenticated Listmonk API for lists, subscribers, campaigns, templates, media, settings, and reporting': 9,
  MCP: 10,
  'Bearer-protected Streamable HTTP endpoint that exposes Listmonk operations as agent tools': 11,
  'The MCP server is ready': 12,
  'The MCP server is not ready': 13,
  'Rotate MCP Bearer': 14,
  'Generate a new MCP client bearer without displaying or logging it': 15,
  'Hermes must receive the new bearer through the protected encrypted handoff before Listmonk is restarted.': 16,
  'MCP Bearer Rotated': 17,
  'The new bearer is stored but was not displayed. Transfer it through the protected encrypted handoff, then restart Listmonk. The prior bearer remains available to the rollback action.': 18,
  'Next Step': 19,
  'Protected transfer and restart required': 20,
  'Rollback MCP Bearer': 21,
  'Swap the current and previous MCP client bearers without displaying either value': 22,
  'Use only during a failed rotation. Hermes and Listmonk must be returned to the same bearer before restart.': 23,
  'MCP Bearer Rolled Back': 24,
  'The prior bearer is active in package state and was not displayed. Restore the matching protected Hermes configuration before restarting services.': 25,
  'Restore matching Hermes configuration before restart': 26,
  'Finalize MCP Bearer Rotation': 27,
  'Remove the retained rollback bearer after the new bearer is verified': 28,
  'Do not finalize until Hermes authenticates with the new bearer and the previous bearer is confirmed rejected.': 29,
  'MCP Bearer Rotation Finalized': 30,
  'The retained rollback bearer was removed from current package state. No credential was displayed.': 31,
  Status: 32,
  'Rotation finalized': 33,
  'One-Time RSA Public Key': 34,
  'Paste the PEM public key generated inside the destination Hermes package. The private key must never leave Hermes.': 35,
  'Export Encrypted MCP Bearer': 36,
  'Encrypt the current Hermes-facing MCP bearer to a one-time RSA public key': 37,
  'Only ciphertext is returned. Keep the matching private key inside Hermes and delete the handoff artifacts after verification.': 38,
  'Encrypted MCP Bearer': 39,
  'Decrypt this ciphertext only inside the destination Hermes package. No plaintext credential was returned.': 40,
  'RSA-OAEP Ciphertext': 41,
  'Base64 ciphertext using RSA-OAEP with SHA-256': 42,
} as const

/**
 * Plumbing. DO NOT EDIT.
 */
export type I18nKey = keyof typeof dict
export type LangDict = Record<(typeof dict)[I18nKey], string>
export default dict
