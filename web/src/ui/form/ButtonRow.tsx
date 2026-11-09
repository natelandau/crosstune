import type { LucideIcon } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { useStampedDensity } from '../../platform/density'
import { Button, type ButtonProps } from '../Button'

export interface ButtonRowButton {
  label: string
  icon?: LucideIcon
  /** Destructive for deleting or leaving; Secondary otherwise. */
  variant?: 'secondary' | 'destructive'
  onPress: ButtonProps['onPress']
  isDisabled?: boolean
  showDone?: boolean
}

/**
 * A row that says what its one action does, then offers it as a real button, so an action
 * never reads as a field. The button trails the text on pointer, and runs full width under it
 * on touch, where a thumb reaches it. Every row has text, a title or a description, so the
 * button always has its label at the row's start. Two actions are two rows.
 */
type ButtonRowText =
  | {
      /** A first line in primary text: what the button acts on, or a status. */
      title: string
      /** What the button does or acts on, read as the button's description. May hold a link. */
      description?: ReactNode
    }
  | { title?: undefined; description: ReactNode }

export function ButtonRow({
  icon,
  title,
  numeric = false,
  description,
  button,
}: ButtonRowText & {
  /** A glyph leading the text, sized and colored by the caller, such as a status. */
  icon?: ReactNode
  /** Tabular figures in the title, for a count that changes, such as bytes on the device. */
  numeric?: boolean
  button: ButtonRowButton
}) {
  const touch = useStampedDensity() === 'touch'
  const titleId = useId()
  const descriptionId = useId()
  const described = description !== undefined && description !== null
  return (
    <div
      className={`t-body flex min-h-(--size-row) px-4 py-1.5 ${touch ? 'flex-col gap-3' : 'items-center gap-4'}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {icon}
        <div className="min-w-0 flex-1 wrap-break-word">
          {title && (
            <p id={titleId} className={numeric ? 't-num' : undefined}>
              {title}
            </p>
          )}
          {described && (
            <p id={descriptionId} className="t-secondary text-secondary">
              {description}
            </p>
          )}
        </div>
      </div>
      {/* Compact beside the text on pointer; full width and the regular height on touch. */}
      <Button
        variant={button.variant ?? 'secondary'}
        size={touch ? 'regular' : 'compact'}
        fullWidth={touch}
        label={button.label}
        icon={button.icon}
        isDisabled={button.isDisabled}
        showDone={button.showDone}
        onPress={button.onPress}
        // A status in the title is read with the button, before what the button does.
        aria-describedby={
          [title && titleId, described && descriptionId].filter(Boolean).join(' ') || undefined
        }
      />
    </div>
  )
}
