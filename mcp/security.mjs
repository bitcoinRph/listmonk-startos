import { timingSafeEqual } from 'node:crypto'

function headerValue(headers, name) {
  if (!headers) return undefined
  if (typeof headers.get === 'function') return headers.get(name) ?? undefined
  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) {
      return Array.isArray(value) ? value[0] : value
    }
  }
  return undefined
}

export function hasToolOverride(request) {
  const url = new URL(request.url ?? '/mcp', 'http://127.0.0.1')
  return (
    url.searchParams.has('tools') ||
    headerValue(request.headers, 'x-listmonk-enabled-tools') !== undefined
  )
}

export function isAuthorizedBearer(provided, expectedToken) {
  if (typeof provided !== 'string' || typeof expectedToken !== 'string') {
    return false
  }

  const expected = Buffer.from(`Bearer ${expectedToken}`)
  const actual = Buffer.from(provided)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
