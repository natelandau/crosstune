import { ChevronDown } from 'lucide-react'
import { Button as AriaButton } from 'react-aria-components'
import { ROW_PRESS } from '../../ui/press'
import { recordingsLine } from './tuneScreenCopy'

/**
 * A free plan's recordings on a tune page, folded into one line that expands in place to the
 * dimmed rows. The line lines its words up with the rows' titles.
 */
export function RecordingsLine({
  count,
  expanded,
  onToggle,
}: {
  count: number
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <AriaButton
      aria-expanded={expanded}
      onPress={onToggle}
      className={`t-body text-secondary -mx-3 flex min-h-(--target) w-[calc(100%+1.5rem)] items-center gap-3 rounded-(--radius-row) px-3 text-start ${ROW_PRESS}`}
    >
      <span className="flex w-7 shrink-0 items-center">
        <ChevronDown
          className={`size-5 transition-transform duration-(--dur-short) ease-(--ease) ${expanded ? '' : '-rotate-90'}`}
          aria-hidden
        />
      </span>
      <span className="min-w-0 flex-1 truncate">{recordingsLine(count)}</span>
    </AriaButton>
  )
}
