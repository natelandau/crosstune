import { STATUSES, type TuneStatus } from '../api/vocabulary'
import { STATUS_LABELS } from '../constants'

const FILL: Record<TuneStatus, string> = {
  known: 'bg-known',
  learning: 'bg-learning',
  want_to_learn: 'bg-unknown',
}

/**
 * One bar split by status in the status colors, each part as long as its count. With `named`
 * the bar says each count; without it the bar is hidden, for a place that says them beside it.
 * Renders nothing while every count is zero.
 */
export function StatusSplitBar({
  byStatus,
  named = false,
  className = '',
}: {
  byStatus: Record<TuneStatus, number>
  named?: boolean
  /** The bar's height and spacing. */
  className?: string
}) {
  const shown = STATUSES.filter((status) => byStatus[status] > 0)
  if (shown.length === 0) return null
  const name = shown.map((status) => `${STATUS_LABELS[status]} ${byStatus[status]}`).join(', ')
  return (
    <span
      {...(named ? { role: 'img', 'aria-label': name } : { 'aria-hidden': true })}
      className={`flex gap-px overflow-hidden rounded-full ${className}`}
    >
      {shown.map((status) => (
        <span key={status} className={FILL[status]} style={{ flexGrow: byStatus[status] }} />
      ))}
    </span>
  )
}
