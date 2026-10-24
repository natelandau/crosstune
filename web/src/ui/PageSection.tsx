import { ChevronRight, Plus, type LucideIcon } from 'lucide-react'
import { useId, type ReactNode, type Ref } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import { Button } from './Button'
import { WASH_HOVER } from './press'
import { InSectionHeading } from './sectionHeading'

/**
 * One section of a document page: its heading in the section heading role with the add control
 * trailing, and its content below. Space sets sections apart, never a hairline. `add` replaces
 * the plain add button where adding opens a menu or needs controls of its own. With `open`, the
 * heading is a disclosure that shows the content only while open.
 */
export function PageSection({
  title,
  addLabel,
  addIcon = Plus,
  onAdd,
  add,
  open,
  onOpenChange,
  ref,
  children,
}: {
  title: string
  addLabel?: string
  /** The add control's icon, such as a pencil once the section has content to edit. */
  addIcon?: LucideIcon
  onAdd?: () => void
  add?: ReactNode
  /** Whether a disclosure section shows its content; leave unset for one always shown. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  ref?: Ref<HTMLElement>
  children?: ReactNode
}) {
  const headingId = useId()
  const disclosure = open !== undefined
  return (
    <section
      ref={ref}
      aria-labelledby={headingId}
      // Clears the sticky pane bar, so a section scrolled into view never hides its heading.
      className="scroll-mt-14 pt-8 first:pt-0"
    >
      <div className="flex min-h-11 items-center justify-between gap-3">
        <h2 id={headingId} className="t-heading">
          {disclosure ? (
            <AriaButton
              aria-expanded={open}
              onPress={() => onOpenChange?.(!open)}
              className={`-mx-2 flex min-h-(--target) items-center gap-1 rounded-(--radius-row) px-2 ${WASH_HOVER}`}
            >
              {title}
              <ChevronRight
                className={`text-ink-2 size-4 transition-transform ${open ? 'rotate-90' : ''}`}
                aria-hidden
              />
            </AriaButton>
          ) : (
            title
          )}
        </h2>
        <InSectionHeading.Provider value={true}>
          {add ??
            (addLabel && onAdd && (
              <Button variant="plain" icon={addIcon} label={addLabel} iconOnly onPress={onAdd} />
            ))}
        </InSectionHeading.Provider>
      </div>
      {children && (!disclosure || open) && <div className="pt-2">{children}</div>}
    </section>
  )
}
