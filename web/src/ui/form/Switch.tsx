import { useId } from 'react'
import { Switch as AriaSwitch } from 'react-aria-components'
import { FIELD_ROW } from './FieldRow'

/** A row that turns a setting on or off; the change saves as it toggles. */
export function Switch({
  label,
  description,
  isSelected,
  onChange,
}: {
  label: string
  /** A sentence under the label saying what the setting means. */
  description?: string
  isSelected: boolean
  onChange: (isSelected: boolean) => void
}) {
  const descriptionId = useId()
  return (
    <AriaSwitch
      aria-describedby={description ? descriptionId : undefined}
      isSelected={isSelected}
      onChange={onChange}
      className={`${FIELD_ROW} group cursor-default justify-between`}
    >
      {/* The label wraps rather than the switch leaving the row, since a switch has no value
          to elide. */}
      {description ? (
        <span className="flex min-w-0 shrink flex-col py-2">
          {label}
          {/* Kept out of the name; aria-describedby still reads it. */}
          <span id={descriptionId} aria-hidden className="t-secondary text-ink-2">
            {description}
          </span>
        </span>
      ) : (
        // Padding of half the target less a line keeps one line at a field row's height and
        // holds a wrap off the row's edges, at either density.
        <span className="min-w-0 shrink py-[calc((var(--target)-1lh)/2)]">{label}</span>
      )}
      {/* Off, a light track whose edge and thumb carry the contrast; on, a slate track. The
          pairs are measured in tokens.test.ts. */}
      <span
        aria-hidden
        className="border-ink-2 bg-fill group-data-[selected]:border-slate group-data-[selected]:bg-slate group-data-[focus-visible]:outline-slate relative box-border h-[31px] w-[51px] shrink-0 rounded-(--radius-capsule) border-2 transition-colors duration-(--dur-short) ease-(--ease) group-data-[focus-visible]:outline-2 group-data-[focus-visible]:outline-offset-2"
      >
        <span className="bg-ink-2 group-data-[selected]:bg-ground absolute top-[3px] left-[3px] size-[21px] rounded-full transition-[translate,background-color] duration-(--dur-short) ease-(--ease) group-data-[selected]:translate-x-5" />
      </span>
    </AriaSwitch>
  )
}
