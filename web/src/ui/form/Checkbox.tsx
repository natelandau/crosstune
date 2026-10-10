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
      className="group before:bg-tint relative flex min-h-(--target) min-w-(--target) shrink-0 cursor-default items-center justify-center rounded-full before:absolute before:size-9 before:scale-60 before:rounded-full before:opacity-0 before:transition-[opacity,scale] before:duration-(--dur-base) before:ease-(--ease) before:content-[''] data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-(--slate) data-[hovered]:before:scale-100 data-[hovered]:before:opacity-100"
    >
      {/* A drawn mark rather than an icon: its outline and check are strokes the selection
          animates, one erasing as the other draws. */}
      <svg
        aria-hidden
        viewBox="0 0 18 18"
        className="check-mark text-ink-2 group-data-[hovered]:text-action group-data-[selected]:text-action relative size-[22px] fill-none stroke-current stroke-2 transition-[color,scale] duration-(--dur-short) ease-(--ease) [stroke-linecap:round] [stroke-linejoin:round] group-data-[pressed]:scale-[0.88]"
      >
        <path d="M 1 9 L 1 9 c 0 -5 3 -8 8 -8 L 9 1 C 14 1 17 5 17 9 L 17 9 c 0 4 -4 8 -8 8 L 9 17 C 5 17 1 14 1 9 L 1 9 Z" />
        <polyline points="1 9 7 14 15 4" className="stroke-[2.5]" />
      </svg>
    </AriaCheckbox>
  )
}
