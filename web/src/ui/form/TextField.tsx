import type { Ref } from 'react'
import { Input, Label, TextArea, TextField as AriaTextField } from 'react-aria-components'
import { NOT_SET } from '../fieldCopy'
import { FIELD_LABEL, FIELD_ROW_BARE } from './FieldRow'

// iOS zooms the page on focus into text under 16px.
const NO_ZOOM = 'in-[html[data-density=touch]]:text-[max(16px,1rem)]'
const BOX = `t-body placeholder:text-ink-2 min-w-0 bg-transparent ${NO_ZOOM}`

/**
 * A text field. A labeled one is a field row, the label leading and the text trailing, empty
 * as "Not set". A standalone one, under a header or as the form's lead field, fills its card
 * and names what goes in it with its placeholder.
 */
export function TextField({
  label,
  value,
  onChange,
  standalone = false,
  multiline = false,
  placeholder = standalone ? label : NOT_SET,
  maxLength,
  rows = 3,
  inputMode,
  enterKeyHint,
  isInvalid = false,
  describedBy,
  autoFocus = false,
  ref,
}: {
  /** The visible label of a row, and the accessible name either way. */
  label: string
  value: string
  onChange: (value: string) => void
  /** Fills the card with no visible label, for a field whose header or sheet names it. */
  standalone?: boolean
  multiline?: boolean
  placeholder?: string
  maxLength?: number
  rows?: number
  inputMode?: 'text' | 'numeric' | 'url'
  enterKeyHint?: 'done' | 'next'
  isInvalid?: boolean
  /** The id of the message that describes the field, such as why it is refused. */
  describedBy?: string
  autoFocus?: boolean
  ref?: Ref<HTMLInputElement & HTMLTextAreaElement>
}) {
  const field = multiline ? (
    <TextArea
      ref={ref}
      rows={rows}
      placeholder={placeholder}
      className={`${BOX} w-full resize-none px-4 py-3`}
    />
  ) : (
    <Input
      ref={ref}
      placeholder={placeholder}
      inputMode={inputMode}
      enterKeyHint={enterKeyHint}
      className={`${BOX} min-h-(--target) flex-1 ${standalone ? 'px-4' : 'pe-4 text-end'}`}
    />
  )
  return (
    <AriaTextField
      aria-label={standalone ? label : undefined}
      value={value}
      onChange={onChange}
      maxLength={maxLength}
      isInvalid={isInvalid}
      aria-describedby={describedBy}
      autoFocus={autoFocus}
      className={standalone ? 'flex' : FIELD_ROW_BARE}
    >
      {!standalone && <Label className={`${FIELD_LABEL} ps-4`}>{label}</Label>}
      {field}
    </AriaTextField>
  )
}
