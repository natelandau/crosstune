/**
 * Where the API is. Empty means the page's own origin, which is what the Worker proxy and the
 * dev proxy both serve. A Capacitor build runs from a custom origin with no API behind it and
 * has to be told an absolute one.
 */
export function normalizeOrigin(value: string | undefined): string {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return ''
  return trimmed.replace(/\/+$/, '')
}

export const API_ORIGIN: string = normalizeOrigin(import.meta.env.VITE_API_ORIGIN)
