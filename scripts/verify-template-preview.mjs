import { readFile } from 'node:fs/promises'

const required = ['LISTMONK_URL', 'LISTMONK_API_USER', 'LISTMONK_API_TOKEN']
for (const name of required) {
  if (!process.env[name]?.trim()) throw new Error(`${name} is required`)
}

const body = await readFile(
  new URL('../templates/owners-brief.html', import.meta.url),
  'utf8',
)
const form = new URLSearchParams({ template_type: 'campaign', body })
const basic = Buffer.from(
  `${process.env.LISTMONK_API_USER}:${process.env.LISTMONK_API_TOKEN}`,
).toString('base64')
const url = `${process.env.LISTMONK_URL.replace(/\/+$/, '')}/api/templates/preview`
const response = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Basic ${basic}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: form,
  signal: AbortSignal.timeout(30_000),
})
const rendered = await response.text()

if (!response.ok) {
  throw new Error(`Listmonk template preview failed with HTTP ${response.status}`)
}
if (!rendered.trim() || !/<html|<table/i.test(rendered)) {
  throw new Error('Listmonk returned an empty or unexpected template preview')
}

console.log(`Listmonk template preview passed (${rendered.length} rendered bytes)`)
