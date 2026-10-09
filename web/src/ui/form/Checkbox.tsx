import { Check } from 'lucide-react'
import { Checkbox as AriaCheckbox } from 'react-aria-components'

/**
 * A checkbox with no text of its own, for a row whose content shows what it includes. `label`
 * is its accessible name, an action plus the thing: "Include Soldier's Joy".
 */
export function Checkbox({
  label,
  isSelected,
  onChange,
}: {
  label: string
  isSelected: boolean
  onChange: (selected: boolean) => void
}) {
  return (
    <AriaCheckbox
      aria-label={label}
      isSelected={isSelected}
      onChange={onChange}
      className="group flex min-h-(--target) min-w-(--target) shrink-0 cursor-default items-center justify-center"
    >
      <span
        aria-hidden
        className="border-ink-2 group-data-[selected]:border-slate group-data-[selected]:bg-slate text-on-slate group-data-[focus-visible]:outline-slate flex size-5 items-center justify-center rounded-md border-2 transition-colors duration-(--dur-short) ease-(--ease) group-data-[focus-visible]:outline-2 group-data-[focus-visible]:outline-offset-2 group-data-[pressed]:opacity-60"
      >
        {isSelected && <Check className="size-4" strokeWidth={3} aria-hidden />}
      </span>
    </AriaCheckbox>
  )
}
