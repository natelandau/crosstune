export const LAST_SYNCED = 'Last synced'
export const JUST_NOW = 'Just now'
export const NOT_SYNCED_YET = 'Not synced yet'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * How long ago the last sync finished, from `iso`, as of `now` in epoch milliseconds. A time
 * ahead of the clock reads as just now, since only a skewed clock puts it there.
 */
export function lastSyncedLabel(iso: string | null, now: number): string {
  const at = iso === null ? NaN : Date.parse(iso)
  if (Number.isNaN(at)) return NOT_SYNCED_YET
  const ago = now - at
  if (ago < MINUTE) return JUST_NOW
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)} min ago`
  if (ago < DAY) return `${Math.floor(ago / HOUR)} hr ago`
  const days = Math.floor(ago / DAY)
  return `${days} ${days === 1 ? 'day' : 'days'} ago`
}

/** The same time as a sentence, such as "Synced 2 min ago". */
export function syncedLine(iso: string | null, now: number): string {
  const label = lastSyncedLabel(iso, now)
  if (label === NOT_SYNCED_YET) return label
  return `Synced ${label === JUST_NOW ? 'just now' : label}`
}
