import type { Ref } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import {
  ANY_LABEL,
  CLEAR_DATE,
  DAY_LABEL,
  dayCount,
  isFullYear,
  MONTH_LABEL,
  MONTH_LABELS,
  MONTHS,
  narrowedParts,
  NO_DATE,
  sameParts,
  YEAR_LABEL,
  type DateParts,
} from '../partialDate'
import { NOT_SET } from '../fieldCopy'
import { FIELD_ROW_PRESSABLE } from './FieldRow'
import { Picker } from './Picker'
import { TextField } from './TextField'

const MONTH_OPTIONS = MONTHS.map((month, index) => ({ id: month, label: MONTH_LABELS[index]! }))

/**
 * A date entered a part at a time: a year, then a month, then a day, with Clear date. Each part
 * waits on the one before it, holding its value while it waits. A `whole` date needs all three,
 * so its month and day read "Not set" rather than "Any" while empty.
 */
export function PartialDateField({
  value,
  onChange,
  whole = false,
  refusedPart = null,
  describedBy,
  onLeave,
  ref,
}: {
  value: DateParts
  onChange: (parts: DateParts) => void
  whole?: boolean
  /** The part marked as the reason the date is refused. */
  refusedPart?: keyof DateParts | null
  /** The id of the message that says why the refused part is refused. */
  describedBy?: string
  /** Called when focus leaves the date, though not for one of its own pickers opening. */
  onLeave?: () => void
  /** Holds every part, for a form that moves focus to the refused one. */
  ref?: Ref<HTMLDivElement>
}) {
  const edit = (patch: Partial<DateParts>) => onChange(narrowedParts(value, patch))
  const monthEnabled = isFullYear(value.year)
  const days = Array.from({ length: dayCount(value) }, (_, index) => String(index + 1))
  const emptyLabel = whole ? NOT_SET : ANY_LABEL
  return (
    <div
      ref={ref}
      className="contents"
      onBlur={(event) => {
        const next = event.relatedTarget
        if (next instanceof Element) {
          if (event.currentTarget.contains(next)) return
          // A picker's list opens in a popover, or on touch in an action sheet of its own.
          const dialog = next.closest('[role=dialog]')
          if (next.closest('[role=listbox]')) return
          if (dialog && dialog !== event.currentTarget.closest('[role=dialog]')) return
        }
        onLeave?.()
      }}
    >
      <TextField
        label={YEAR_LABEL}
        value={value.year}
        inputMode="numeric"
        enterKeyHint="done"
        maxLength={4}
        isInvalid={refusedPart === 'year'}
        describedBy={refusedPart === 'year' ? describedBy : undefined}
        onChange={(year) => edit({ year: year.replace(/\D/g, '') })}
      />
      <Picker
        label={MONTH_LABEL}
        value={value.month || null}
        options={MONTH_OPTIONS}
        emptyLabel={emptyLabel}
        isDisabled={!monthEnabled}
        isInvalid={refusedPart === 'month'}
        describedBy={describedBy}
        onChange={(month) => edit({ month: month ?? '' })}
      />
      <Picker
        label={DAY_LABEL}
        value={value.day || null}
        options={days.map((day) => ({ id: day, label: day }))}
        emptyLabel={emptyLabel}
        isDisabled={!monthEnabled || value.month === ''}
        isInvalid={refusedPart === 'day'}
        describedBy={describedBy}
        onChange={(day) => edit({ day: day ?? '' })}
      />
      <AriaButton
        isDisabled={sameParts(value, NO_DATE)}
        onPress={() => onChange(NO_DATE)}
        className={`${FIELD_ROW_PRESSABLE} text-action font-medium disabled:opacity-40`}
      >
        {CLEAR_DATE}
      </AriaButton>
    </div>
  )
}
