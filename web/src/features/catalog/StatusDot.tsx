import type { SongStatus } from '../../db/types'

// eslint-disable-next-line react-refresh/only-export-components
export const STATUS_LABELS: Record<SongStatus, string> = {
  known: 'Known',
  learning: 'Learning',
  want_to_learn: 'Want to learn',
}

const DOT_CLASSES: Record<SongStatus, string> = {
  known: 'bg-success',
  learning: 'bg-info',
  want_to_learn: 'border-base-content/60 border-2',
}

// eslint-disable-next-line react-refresh/only-export-components
export function isSongStatus(value: string): value is SongStatus {
  return Object.hasOwn(STATUS_LABELS, value)
}

export function StatusDot({ status }: { status: string }) {
  const known = isSongStatus(status) ? status : 'want_to_learn'
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span aria-hidden="true" className={`size-2.5 rounded-full ${DOT_CLASSES[known]}`} />
      {STATUS_LABELS[known]}
    </span>
  )
}
