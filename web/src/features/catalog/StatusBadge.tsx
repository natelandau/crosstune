import type { SongStatus } from '../../db/types'

// eslint-disable-next-line react-refresh/only-export-components
export const STATUS_LABELS: Record<SongStatus, string> = {
  known: 'Known',
  learning: 'Learning',
  want_to_learn: 'Want to learn',
}

const STATUS_CLASSES: Record<SongStatus, string> = {
  known: 'badge-success',
  learning: 'badge-info',
  want_to_learn: 'badge-ghost',
}

// eslint-disable-next-line react-refresh/only-export-components
export function isSongStatus(value: string): value is SongStatus {
  return Object.hasOwn(STATUS_LABELS, value)
}

export function StatusBadge({ status }: { status: string }) {
  const known = isSongStatus(status) ? status : 'want_to_learn'
  return <span className={`badge badge-sm ${STATUS_CLASSES[known]}`}>{STATUS_LABELS[known]}</span>
}
