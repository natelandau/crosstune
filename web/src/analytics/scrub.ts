import { SETTINGS_PAGE_IDS } from '../features/settings/settingsPaths'

const KEPT_SEGMENTS = new Set<string>([
  'catalog',
  'lists',
  'tunes',
  'recordings',
  'settings',
  'stats',
  'kit',
  ...SETTINGS_PAGE_IDS,
])

const URL_KEYS = ['$current_url', '$initial_current_url', '$session_entry_url']
const PATH_KEYS = ['$pathname', '$initial_pathname', '$session_entry_pathname']
const REFERRER_KEYS = ['$referrer', '$initial_referrer', '$session_entry_referrer']

/** The app's own words stay; every other segment, which may be an ID or typed text, becomes `:id`. */
export function routePattern(pathname: string): string {
  const path = pathname.split(/[?#]/, 1)[0] ?? ''
  const segments = path.split('/').filter(Boolean)
  if (segments.length === 0) return '/'
  return `/${segments.map((s) => (KEPT_SEGMENTS.has(s) ? s : ':id')).join('/')}`
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

/** A URL reduced to its origin and route pattern. Input that is not a URL becomes `/`, never empty. */
export function scrubUrl(url: string): string {
  const parsed = parseUrl(url)
  return parsed ? `${parsed.origin}${routePattern(parsed.pathname)}` : '/'
}

function scrubBag(bag: Record<string, unknown>): Record<string, unknown> {
  const out = { ...bag }
  for (const key of URL_KEYS) {
    const value = out[key]
    if (typeof value !== 'string') continue
    if (parseUrl(value)) out[key] = scrubUrl(value)
    else delete out[key]
  }
  for (const key of PATH_KEYS) {
    const value = out[key]
    if (typeof value === 'string') out[key] = routePattern(value)
  }
  for (const key of REFERRER_KEYS) {
    const value = out[key]
    if (typeof value !== 'string' || value === '' || value === '$direct') continue
    const url = parseUrl(value)
    if (url) out[key] = url.hostname
    else delete out[key]
  }
  return out
}

/** The `before_send` hook: reduces every URL on an event to a route pattern or a domain. */
export function scrubEvent<T extends { properties: Record<string, unknown> }>(
  event: T | null,
): T | null {
  if (!event) return event
  const out: Record<string, unknown> = { ...event, properties: scrubBag(event.properties) }
  for (const key of ['$set', '$set_once']) {
    const nested = out[key]
    if (nested && typeof nested === 'object') {
      out[key] = scrubBag(nested as Record<string, unknown>)
    }
    const inner = (out.properties as Record<string, unknown>)[key]
    if (inner && typeof inner === 'object') {
      ;(out.properties as Record<string, unknown>)[key] = scrubBag(inner as Record<string, unknown>)
    }
  }
  return out as T
}
