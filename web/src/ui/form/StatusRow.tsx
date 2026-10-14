import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useStampedDensity } from '../../platform/density'
import { Button } from '../Button'

export interface StatusAction {
  label: string
  onPress: () => void
  isDisabled?: boolean
  icon?: LucideIcon
  /** A drawn glyph in place of `icon`, such as one that spins while the action runs. */
  glyph?: ReactNode
}

/**
 * A row that states something and offers the one action on it, such as the sync state and Sync
 * now. The action is a button, never a row that only reads like one. It trails the text on
 * pointer, and runs full width under it on touch, where a thumb reaches it.
 */
export function StatusRow({
  icon,
  title,
  detail,
  numeric = false,
  action,
}: {
  /** A glyph leading the title, sized and colored by the caller. */
  icon?: ReactNode
  title: string
  detail?: string
  /** Tabular figures in the title, for a count that changes, such as bytes on the device. */
  numeric?: boolean
  action?: StatusAction
}) {
  const touch = useStampedDensity() === 'touch'
  return (
    <div className={`flex gap-3 px-4 py-3 ${touch ? 'flex-col' : 'items-center'}`}>
      <div className="flex min-h-(--target-control) min-w-0 flex-1 items-center gap-3">
        {icon}
        <div className="min-w-0 flex-1">
          <p className={`t-body ${numeric ? 't-num' : ''}`}>{title}</p>
          {detail && <p className="t-secondary text-ink-2">{detail}</p>}
        </div>
      </div>
      {action && (
        <div className={`flex ${touch ? '' : 'shrink-0'}`}>
          <Button
            variant="bordered"
            fullWidth={touch}
            label={action.label}
            icon={action.icon}
            glyph={action.glyph}
            isDisabled={action.isDisabled}
            onPress={action.onPress}
          />
        </div>
      )}
    </div>
  )
}
