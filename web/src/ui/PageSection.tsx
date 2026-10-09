import { Plus, type LucideIcon } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { Button } from './Button'

/**
 * One section of a document page: its heading in the section heading role with the add control
 * trailing, and its content below. Space sets sections apart, never a hairline. `add` replaces
 * the plain add button where adding opens a menu or needs a reason it cannot run.
 */
export function PageSection({
  title,
  addLabel,
  addIcon = Plus,
  onAdd,
  addDisabled = false,
  addUnavailable,
  add,
  children,
}: {
  title: string
  addLabel?: string
  /** The add control's icon, such as a pencil once the section has content to edit. */
  addIcon?: LucideIcon
  onAdd?: () => void
  /** Keeps the add control in place while adding cannot run, such as while a tune is full. */
  addDisabled?: boolean
  /** Why adding cannot run at all yet; the control stays, disabled, with this as its description. */
  addUnavailable?: string
  add?: ReactNode
  children?: ReactNode
}) {
  const headingId = useId()
  const reasonId = useId()
  return (
    <section aria-labelledby={headingId} className="pt-8 first:pt-0">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <h2 id={headingId} className="t-heading">
          {title}
        </h2>
        {add ??
          (addLabel && (onAdd || addUnavailable) && (
            <>
              <Button
                variant="plain"
                icon={addIcon}
                label={addLabel}
                iconOnly
                isDisabled={addDisabled || addUnavailable !== undefined}
                aria-describedby={addUnavailable && reasonId}
                onPress={onAdd}
              />
              {addUnavailable && (
                <span id={reasonId} hidden>
                  {addUnavailable}
                </span>
              )}
            </>
          ))}
      </div>
      {children && <div className="pt-2">{children}</div>}
    </section>
  )
}
