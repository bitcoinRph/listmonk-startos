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
  'Get Admin Credentials': 8,
  'Show the admin username and the password listmonk was set up with': 9,
  'listmonk Admin Credentials': 10,
  'Log in at /admin on the Web UI address. This is the password listmonk was set up with. If you changed it inside listmonk, use your new password instead.': 11,
  Username: 12,
  Password: 13,
  'Retrieve your listmonk admin login': 14,
} as const

/**
 * Plumbing. DO NOT EDIT.
 */
export type I18nKey = keyof typeof dict
export type LangDict = Record<(typeof dict)[I18nKey], string>
export default dict
