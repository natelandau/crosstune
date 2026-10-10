import { Check, ChevronsUpDown } from 'lucide-react'
import { useRef, useState } from 'react'
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
import { OTHER_OPTION, otherLabel } from './suggestCopy'
import { containsText } from '../../text/fold'
import { NOT_SET } from '../fieldCopy'
import { OverlayClaim } from '../overlayClaim'
import { FIELD_LABEL, FIELD_ROW_BARE } from './FieldRow'
import { TextField } from './TextField'

// Sentinels no suggestion can be, so neither choice collides with a real value.
const OTHER = '\u0000other'
const NONE = '\u0000none'
const KEEP = '\u0000keep'

/** A leading choice that leaves the field as it is, for a row over values that disagree. */
export interface SuggestKeep {
  label: string
  /** True while the field is left as it is, so the row reads `label`. */
  kept: boolean
  onKeep: () => void
}

/**
 * An open vocabulary as a field row: typing narrows the suggestions, Not set empties the
 * field, and Other… reveals a text field for a value no suggestion holds. A typed value shows
 * as its own suggestion after. Other… keeps the current value, which the revealed field starts
 * from, until the musician types.
 */
export function SuggestField({
  label,
  rowLabel = label,
  value,
  suggestions,
  maxLength,
  keep,
  onChange,
}: {
  /** The accessible name, and the visible label unless `rowLabel` shortens it. */
  label: string
  /** The visible label, for a row under a header that already carries part of the name. */
  rowLabel?: string
  value: string
  suggestions: readonly string[]
  maxLength?: number
  keep?: SuggestKeep
  onChange: (value: string) => void
}) {
  const [typing, setTyping] = useState(false)
  // Whether the press now down began on the field row: its label, input, or chevron. The list
  // opens as the press starts, so a quick click can lift over an option, and React Aria picks
  // an option on any mouse release over it, wherever the press began.
  const pressOnField = useRef(false)
  const kept = keep?.kept === true
  // What the input shows, so only the Not set label itself is dimmed, never typed text.
  const [shown, setShown] = useState(keep?.kept ? keep.label : value === '' ? NOT_SET : value)
  const choices =
    value !== '' && !suggestions.includes(value) ? [...suggestions, value] : suggestions
  const items = [
    ...(keep ? [{ id: KEEP, label: keep.label }] : []),
    { id: NONE, label: NOT_SET },
    ...choices.map((choice) => ({ id: choice, label: choice })),
    { id: OTHER, label: OTHER_OPTION },
  ]

  const choose = (key: Key | null) => {
    if (key === OTHER) {
      setTyping(true)
      return
    }
    setTyping(false)
    if (key === KEEP) keep?.onKeep()
    else onChange(key === null || key === NONE ? '' : String(key))
  }

  return (
    <>
      <ComboBox
        items={items}
        // An empty value is the Not set choice itself, so picking it commits like any other
        // choice and the list stays closed after.
        value={kept ? KEEP : value === '' ? NONE : value}
        onChange={choose}
        onInputChange={setShown}
        menuTrigger="focus"
        // Not set and Other… stay offered whatever is typed: they are the ways to no value and
        // to a value none match.
        defaultFilter={(text, input) =>
          text === NOT_SET ||
          text === OTHER_OPTION ||
          text === keep?.label ||
          containsText(text, input)
        }
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
          // Typing replaces the Not set label rather than adding to it.
          onFocus={(event) => {
            if (shown === NOT_SET || shown === keep?.label) event.currentTarget.select()
          }}
          className={`t-body min-h-(--target) min-w-0 flex-1 truncate bg-transparent text-end in-[html[data-density=touch]]:text-[max(16px,1rem)] ${(value === '' && shown === NOT_SET) || (keep?.kept && shown === keep.label) ? 'text-ink-2' : 'text-ink'}`}
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
                textValue={item.label}
                className="t-body data-[focused]:bg-fill flex min-h-(--target) cursor-default items-center gap-3 rounded-(--radius-row) px-3 py-1"
              >
                {({ isSelected }) => (
                  <>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {isSelected && <Check className="text-action size-5 shrink-0" aria-hidden />}
                  </>
                )}
              </ListBoxItem>
            )}
          </ListBox>
        </Popover>
      </ComboBox>
      {typing && (
        <TextField
          label={otherLabel(label)}
          value={value}
          onChange={onChange}
          maxLength={maxLength}
          autoFocus
        />
      )}
    </>
  )
}
