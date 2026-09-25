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
} as const

/**
 * Plumbing. DO NOT EDIT.
 */
export type I18nKey = keyof typeof dict
export type LangDict = Record<(typeof dict)[I18nKey], string>
export default dict
