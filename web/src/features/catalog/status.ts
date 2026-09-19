import type { SongStatus } from '../../db/types'

export const STATUS_LABELS: Record<SongStatus, string> = {
  known: 'Known',
  learning: 'Learning',
  want_to_learn: 'Unknown',
}

export function isSongStatus(value: string): value is SongStatus {
  return Object.hasOwn(STATUS_LABELS, value)
}
