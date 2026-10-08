import { Check, ChevronsUpDown } from 'lucide-react'
import {
  Button as AriaButton,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
  type Key,
} from 'react-aria-components'
import { useRef } from 'react'
import { useStampedDensity } from '../../platform/density'
import { Menu } from '../Menu'
import { OverlayClaim } from '../overlayClaim'
import { FIELD_LABEL, FIELD_ROW, FIELD_ROW_BARE, FIELD_VALUE_SHAPE } from './FieldRow'

export interface PickerOption {
  id: string
  label: string
}

// No option id can be the empty choice's: ids are stored values, which never hold a NUL.
const EMPTY = '\u0000empty'

const INVALID = 'ring-danger rounded-(--radius-surface) ring-2 ring-inset'

/**
 * A closed choice as a field row: the label leads and the current value trails, eliding
 * first. It opens an action sheet on touch and a popover list box on pointer, with the empty
 * choice, named for what it does, first when there is one.
 */
export function Picker({
  label,
  value,
  options,
  emptyLabel,
  isDisabled = false,
  isInvalid = false,
  describedBy,
  onChange,
  onChoose,
}: {
  label: string
  /** The chosen option's id, or null for the empty choice. */
  value: string | null
  options: readonly PickerOption[]
  /** Names the empty choice; without it the choice is required and offers no empty one. */
  emptyLabel?: string
  /** Holds the row still, its value showing, until the field it narrows has one. */
  isDisabled?: boolean
  /** Marks the row as the reason its form is refused. */
  isInvalid?: boolean
  /** The id of the message that says why the row is refused. */
  describedBy?: string
  onChange: (id: string | null) => void
  /** Called on every pick, never on a dismissal. A pick of the value already chosen sends no
   * change, so this is the one sign that the musician chose it. */
  onChoose?: () => void
}) {
  const touch = useStampedDensity() === 'touch'
  // Held from a press on an option to its end, and read as the list closes, since a pick and
  // a dismissal close it alike and a pick of the current value sends no change. React Aria
  // picks from the keyboard, and so closes, before the item's own press start runs, so the
  // close reads it a microtask later. A press that ends off its option clears it a task later,
  // since a screen reader's click ends its press before it picks.
  const picking = useRef(false)
  // A button may not carry aria-invalid, so a refused row is described by its reason and
  // drawn in the danger color; data-invalid also lets a form find it to focus.
  const invalid = isInvalid ? INVALID : ''
  // A value no option holds, such as a stale filter, keeps an option of its own so it never
  // reads as the empty choice.
  const stale = value !== null && !options.some((option) => option.id === value)
  const all: PickerOption[] = [
    ...(emptyLabel === undefined ? [] : [{ id: EMPTY, label: emptyLabel }]),
    ...options,
    ...(stale ? [{ id: value, label: value }] : []),
  ]
  const selected = value ?? EMPTY
  const choose = (id: Key | null) => onChange(id === null || id === EMPTY ? null : String(id))
  const shown = all.find((option) => option.id === selected)?.label ?? emptyLabel ?? ''
  // A chosen value reads as a value; the empty choice reads like Not set in a text field.
  const valueClass = `${FIELD_VALUE_SHAPE} ${selected === EMPTY ? 'text-ink-2' : 'text-ink'}`

  if (touch) {
    return (
      <Menu
        label={label}
        choiceMode="single"
        trigger={
          <AriaButton
            isDisabled={isDisabled}
            aria-describedby={isInvalid ? describedBy : undefined}
            data-invalid={isInvalid || undefined}
            className={`${FIELD_ROW} disabled:opacity-40 ${invalid}`}
          >
            <span className={FIELD_LABEL}>{label}</span>
            <span className={valueClass}>{shown}</span>
            <ChevronsUpDown className="text-ink-2 size-4 shrink-0" aria-hidden />
          </AriaButton>
        }
        items={all.map((option) => ({
          id: option.id,
          label: option.label,
          checked: option.id === selected,
          onAction: () => {
            choose(option.id)
            onChoose?.()
          },
        }))}
      />
    )
  }

  return (
    <Select
      value={selected}
      onChange={(id) => choose(id as Key | null)}
      isDisabled={isDisabled}
      isInvalid={isInvalid}
      onOpenChange={(open) => {
        if (open) picking.current = false
        else
          queueMicrotask(() => {
            if (picking.current) onChoose?.()
            picking.current = false
          })
      }}
      className={`${FIELD_ROW_BARE} relative data-[disabled]:opacity-40 ${invalid}`}
    >
      <Label className={`${FIELD_LABEL} ps-4`}>{label}</Label>
      {/* The button's hit area covers the whole row, so a press on the label opens it too. */}
      <AriaButton
        aria-describedby={isInvalid ? describedBy : undefined}
        data-invalid={isInvalid || undefined}
        className="flex min-h-(--target) min-w-0 flex-1 items-center justify-end gap-1 pe-4 after:absolute after:inset-0 after:content-['']"
      >
        <SelectValue className={valueClass} />
        <ChevronsUpDown className="text-ink-2 size-4 shrink-0" aria-hidden />
      </AriaButton>
      <Popover
        placement="bottom end"
        className="bg-ground max-h-80 min-w-48 overflow-y-auto rounded-(--radius-surface) p-1 shadow-(--shadow-float)"
      >
        <OverlayClaim />
        {/* Escape always dismisses, even with a press still held on an option. */}
        <div
          onKeyDownCapture={(event) => {
            if (event.key === 'Escape') picking.current = false
          }}
        >
          <ListBox items={all} className="outline-none">
            {(option) => (
              <ListBoxItem
                id={option.id}
                textValue={option.label}
                onPressStart={() => void (picking.current = true)}
                onPressEnd={() => void setTimeout(() => void (picking.current = false))}
                className="t-body data-[focused]:bg-fill flex min-h-(--target) cursor-default items-center gap-3 rounded-(--radius-row) px-3 py-1"
              >
                {({ isSelected }) => (
                  <>
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {isSelected && <Check className="text-slate size-5 shrink-0" aria-hidden />}
                  </>
                )}
              </ListBoxItem>
            )}
          </ListBox>
        </div>
      </Popover>
    </Select>
  )
}
