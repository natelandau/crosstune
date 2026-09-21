import { ChevronRight } from 'lucide-react'
import { useId, type ReactNode } from 'react'

/**
 * Where a naming header leads. `openName` is the verb its control takes, read before the name
 * the header carries, so a screen reader hears "Open Soldier's Joy"; it is required alongside
 * `onOpen`, since a control nothing names is a control nothing can announce.
 */
type Opening =
  { onOpen: () => void; openName: string } | { onOpen?: undefined; openName?: undefined }

/**
 * A group header above an inset list. It sits at the text inset rather than the card edge, so
 * it lines up with the row labels under it. The space above it belongs to the section, which is
 * what makes a header read as part of the group it names rather than as a line adrift between
 * two of them.
 *
 * A header labels its section by default, in the footnote role and the secondary color, quieter
 * than the rows beneath it. `names` instead marks a header carrying the name of the thing those
 * rows belong to, such as the song over its recordings. It takes the title role, one step under
 * the screen's own title, so the screen reads from its title down to its rows rather than flat
 * across them, and it keeps the tap height whether or not it opens anything, so every group on
 * a screen sets its rows off by the same distance.
 */
export function SectionHeader({
  children,
  names = false,
  actions,
  onOpen,
  openName,
}: {
  children: ReactNode
  names?: boolean
  /**
   * Controls at the trailing edge. A header that opens something of its own has no room for
   * them: its whole line is the control, and anything laid over that line would take the taps
   * meant for it. Such a header drops them.
   */
  actions?: ReactNode
} & Opening) {
  const verbId = useId()
  const nameId = useId()
  if (!names) {
    return (
      // The line is a 44px control plus the gap a header keeps from its card, since the box
      // includes that padding. The height holds whether or not this header carries a control,
      // so two groups on one screen set their cards off alike. A sheet's field sections have
      // nothing to add to and stay dense.
      <div
        data-section-header
        className="flex min-h-[calc(44px+var(--form-text-gap))] items-center gap-2 px-(--form-inset) pb-(--form-text-gap) [ion-modal_&]:min-h-0"
      >
        <h2 className="type-footnote m-0 min-w-0 flex-1 truncate">{children}</h2>
        {actions}
      </div>
    )
  }
  const heading = (
    <h2 id={nameId} className="type-title m-0 min-w-0 flex-1 truncate">
      {children}
    </h2>
  )
  const line = 'flex min-h-[44px] items-center gap-2 px-(--form-inset) pb-(--form-text-gap)'
  if (!onOpen)
    return (
      <div data-section-header className={line}>
        {heading}
        {actions}
      </div>
    )
  return (
    <div data-section-header className={`relative ${line}`}>
      {heading}
      <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-(--ion-color-medium)" />
      {/* The verb sits beside the name rather than on the control, so the heading keeps the
          name by itself while the control still reads as the verb and the thing. */}
      <span id={verbId} className="sr-only">
        {openName}
      </span>
      <button
        type="button"
        aria-labelledby={`${verbId} ${nameId}`}
        onClick={onOpen}
        className="absolute inset-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-(--ion-color-primary)"
      />
    </div>
  )
}
