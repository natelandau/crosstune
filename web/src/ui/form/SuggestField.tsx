import { Check, ChevronsUpDown } from 'lucide-react'
import { useRef } from 'react'
import {
  Button as AriaButton,
  ComboBox,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  type Key,
} from 'react-aria-components'
import { containsText } from '../../text/fold'
import { OverlayClaim } from '../overlayClaim'
import { FIELD_LABEL, FIELD_ROW_BARE } from './FieldRow'

// No suggestion can be this, so the choice never collides with a real value.
const KEEP = '\u0000keep'

/** A leading choice that leaves the field as it is, for a row over values that disagree. */
export interface SuggestKeep {
  label: string
  /** True while the field is left as it is, so the empty field shows `label` as a placeholder. */
  kept: boolean
  onKeep: () => void
}

/**
 * An open vocabulary as a field row: the musician types the value straight in, and the
 * suggestions below narrow as they type. Picking a suggestion sets it, and a value no suggestion
 * holds is as good as one that does. An empty field is empty, and deleting the text empties it.
 */
export function SuggestField({
  label,
  rowLabel = label,
  value,
  suggestions,
  maxLength,
  keep,
  autoFocus = false,
  onChange,
  onPick,
}: {
  /** The accessible name, and the visible label unless `rowLabel` shortens it. */
  label: string
  /** The visible label, for a row under a header that already carries part of the name. */
  rowLabel?: string
  value: string
  suggestions: readonly string[]
  maxLength?: number
  keep?: SuggestKeep
  autoFocus?: boolean
  onChange: (value: string) => void
  /** Called after `onChange` when the value came from picking a suggestion rather than typing. */
  onPick?: (value: string) => void
}) {
  // Whether the press now down began on the field row: its label, input, or chevron. The list
  // opens as the press starts, so a quick click can lift over an option, and React Aria picks
  // an option on any mouse release over it, wherever the press began.
  const pressOnField = useRef(false)
  const kept = keep?.kept === true
  const items = [
    // Offered only once the row is touched: a kept row already reads as kept. Its text is
    // empty, which React Aria writes to the input on a pick, so the kept field shows empty.
    ...(keep && !kept ? [{ id: KEEP, label: keep.label, text: '' }] : []),
    ...suggestions.map((choice) => ({ id: choice, label: choice, text: choice })),
  ]

  const choose = (key: Key | null) => {
    // A null key is React Aria letting go of a pick as the text moves on, which the typed text
    // already carries.
    if (key === null) return
    if (key === KEEP) keep?.onKeep()
    else {
      onChange(String(key))
      onPick?.(String(key))
    }
  }

  return (
    <ComboBox
      defaultItems={items}
      allowsCustomValue
      // Only the text is controlled: React Aria owns the pick, so it closes the list after one
      // and never as typed text happens to match a suggestion.
      inputValue={kept ? '' : value}
      onInputChange={(text) => {
        if (!(kept && text === '')) onChange(text)
      }}
      onChange={choose}
      menuTrigger="focus"
      // Keep alone has empty text, so it stays offered whatever is typed.
      defaultFilter={(text, input) => text === '' || containsText(text, input)}
      className={`${FIELD_ROW_BARE} relative`}
      // Capture, since the chevron's press handling stops the event from bubbling.
      onPointerDownCapture={(event) => {
        // The list is portaled, so a press on an option reaches this handler through React
        // but lies outside the row on the page.
        if (!event.currentTarget.contains(event.target as Node)) return
        pressOnField.current = true
        // Cleared once the release has been handled, so a later press on an option counts.
        const clear = () => {
          window.removeEventListener('pointerup', clear, true)
          window.removeEventListener('pointercancel', clear, true)
          setTimeout(() => (pressOnField.current = false))
        }
        window.addEventListener('pointerup', clear, true)
        window.addEventListener('pointercancel', clear, true)
      }}
    >
      <Label className={`${FIELD_LABEL} ps-4`}>
        {rowLabel === label ? (
          label
        ) : (
          <>
            <span aria-hidden>{rowLabel}</span>
            <span className="sr-only">{label}</span>
          </>
        )}
      </Label>
      <Input
        autoFocus={autoFocus}
        maxLength={maxLength}
        placeholder={kept ? keep.label : undefined}
        className="t-body text-ink placeholder:text-ink-2 min-h-(--target) min-w-0 flex-1 truncate bg-transparent text-end in-[html[data-density=touch]]:text-[max(16px,1rem)]"
      />
      <AriaButton className="text-ink-2 flex min-h-(--target) shrink-0 items-center pe-4">
        <ChevronsUpDown className="size-4" aria-hidden />
      </AriaButton>
      <Popover
        placement="bottom end"
        className="bg-ground max-h-80 min-w-48 overflow-y-auto rounded-(--radius-surface) p-1 shadow-(--shadow-float)"
      >
        <OverlayClaim />
        <ListBox
          className="outline-none"
          onPointerUpCapture={(event) => {
            if (pressOnField.current) event.stopPropagation()
          }}
        >
          {(item: (typeof items)[number]) => (
            <ListBoxItem
              id={item.id}
              textValue={item.text}
              className="t-body data-[focused]:bg-field flex min-h-(--target) cursor-default items-center gap-3 rounded-(--radius-row) px-3 py-1"
            >
              {({ isSelected }) => (
                <>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {isSelected && <Check className="text-ink size-5 shrink-0" aria-hidden />}
                </>
              )}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </ComboBox>
  )
}
