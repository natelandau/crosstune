import { Plus, type LucideIcon } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { Button } from './Button'
import { InSectionHeading } from './sectionHeading'

/**
 * One section of a document page: its heading in the section heading role with the add control
 * trailing, and its content below. Space sets sections apart, never a hairline. `add` replaces
 * the plain add button where adding opens a menu or needs controls of its own.
 */
export function PageSection({
  title,
  addLabel,
  addIcon = Plus,
  onAdd,
  add,
  children,
}: {
  title: string
  addLabel?: string
  /** The add control's icon, such as a pencil once the section has content to edit. */
  addIcon?: LucideIcon
  onAdd?: () => void
  add?: ReactNode
  children?: ReactNode
}) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="pt-8 first:pt-0">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <h2 id={headingId} className="t-heading">
          {title}
        </h2>
        <InSectionHeading.Provider value={true}>
          {add ??
            (addLabel && onAdd && (
              <Button variant="plain" icon={addIcon} label={addLabel} iconOnly onPress={onAdd} />
            ))}
        </InSectionHeading.Provider>
      </div>
      {children && <div className="pt-2">{children}</div>}
    </section>
  )
}
