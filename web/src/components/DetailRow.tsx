import { ChevronRight } from 'lucide-react'
import { useId } from 'react'

const ROW = 'flex min-h-12 w-full items-center gap-3 py-1 text-left'

/** One line of a details list: label, the current value, and a chevron; tapping opens its editor. */
export function DetailRow({
  label,
  value,
  placeholder = 'Not set',
  onPress,
}: {
  label: string
  value: string
  placeholder?: string
  onPress: () => void
}) {
  return (
    <button type="button" className={ROW} onClick={onPress}>
      <span className="text-label shrink-0">{label}</span>{' '}
      <span
        className={`min-w-0 flex-1 truncate text-right tabular-nums ${value ? '' : 'opacity-60'}`}
      >
        {value || placeholder}
      </span>
      <ChevronRight aria-hidden="true" className="size-5 shrink-0 opacity-60" />
    </button>
  )
}

export function SwitchRow({
  label,
  checked,
  onChange,
  help,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  help?: string
}) {
  const helpId = useId()
  return (
    <label className={`${ROW} cursor-pointer justify-between`}>
      <span className="min-w-0">
        <span className="text-label block">{label}</span>
        {help ? (
          <span id={helpId} className="text-meta block opacity-70">
            {help}
          </span>
        ) : null}
      </span>
      <input
        type="checkbox"
        className="toggle shrink-0"
        // The label names the switch, which leaves the help text outside the accessible name.
        aria-label={label}
        aria-describedby={help ? helpId : undefined}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  )
}

/** The platform date picker is good on every phone, so the date edits in the row itself. */
export function DateRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className={`${ROW} justify-between`}>
      <span className="text-label shrink-0">{label}</span>
      <input
        type="date"
        // daisyUI pins the calendar indicator 0.75em from the right edge, so the text needs
        // right padding to clear it, and right alignment comes from the row, not text-align.
        className="input input-ghost ml-auto h-11 w-auto min-w-0 pr-9 pl-1 tabular-nums"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}
