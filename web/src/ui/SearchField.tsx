import { Search, X } from 'lucide-react'
import { useState, type Ref } from 'react'
import { Button, Input, SearchField as AriaSearchField } from 'react-aria-components'
import { CLEAR_SEARCH } from './searchCopy'
import { PRESS, TINT_HOVER } from './press'
import { FIELD_INPUT_TAP_AREA, TAP_AREA } from './tapArea'

/** A search capsule, for a search built on another field, such as one that drives a list. */
export const SEARCH_BOX =
  'bg-field flex min-h-(--size-regular) items-center rounded-(--radius-capsule) ps-3 pe-1'

/** The input inside `SEARCH_BOX`. */
export const SEARCH_INPUT = `t-body placeholder:text-secondary min-w-0 flex-1 bg-transparent px-2 in-[html[data-density=touch]]:text-[max(16px,1rem)] ${FIELD_INPUT_TAP_AREA}`

/**
 * A search box named for what it searches, with the name as its placeholder. Clear shows only
 * while the field has focus and holds text. On touch the text never drops below 16px, the size
 * under which iOS zooms the page on focus.
 */
export function SearchField({
  label,
  value,
  onChange,
  onSubmit,
  maxLength,
  describedBy,
  ref,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  onSubmit?: () => void
  maxLength?: number
  /** The id of the element that describes the field, such as the search's status. */
  describedBy?: string
  ref?: Ref<HTMLInputElement>
}) {
  const [focused, setFocused] = useState(false)
  return (
    <AriaSearchField
      data-focus-host
      aria-label={label}
      aria-describedby={describedBy}
      maxLength={maxLength}
      value={value}
      onChange={onChange}
      onSubmit={onSubmit}
      onFocusChange={setFocused}
      className={`${SEARCH_BOX} relative`}
    >
      <Search className="text-secondary size-4 shrink-0" aria-hidden />
      <Input
        ref={ref}
        placeholder={label}
        className={`${SEARCH_INPUT} [&::-webkit-search-cancel-button]:hidden`}
      />
      {focused && value !== '' && (
        <Button
          aria-label={CLEAR_SEARCH}
          className={`text-secondary inline-flex size-(--size-regular) shrink-0 items-center justify-center rounded-full ${TAP_AREA} ${PRESS} ${TINT_HOVER}`}
        >
          <X className="size-4" aria-hidden />
        </Button>
      )}
    </AriaSearchField>
  )
}
