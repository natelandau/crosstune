import { Search, X } from 'lucide-react'
import { useState, type Ref } from 'react'
import { Button, Input, SearchField as AriaSearchField } from 'react-aria-components'
import { CLEAR_SEARCH } from './searchCopy'

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
  ref,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  onSubmit?: () => void
  ref?: Ref<HTMLInputElement>
}) {
  const [focused, setFocused] = useState(false)
  return (
    <AriaSearchField
      data-search-field
      aria-label={label}
      value={value}
      onChange={onChange}
      onSubmit={onSubmit}
      onFocusChange={setFocused}
      className="bg-fill relative flex min-h-(--target-control) items-center rounded-(--radius-capsule) ps-3 pe-1"
    >
      <Search className="text-ink-2 size-4 shrink-0" aria-hidden />
      <Input
        ref={ref}
        placeholder={label}
        className="t-body placeholder:text-ink-2 min-w-0 flex-1 bg-transparent px-2 in-[html[data-density=touch]]:text-[max(16px,1rem)] [&::-webkit-search-cancel-button]:hidden"
      />
      {focused && value !== '' && (
        <Button
          aria-label={CLEAR_SEARCH}
          className="text-ink-2 inline-flex size-(--target-control) shrink-0 items-center justify-center rounded-full data-[pressed]:opacity-60"
        >
          <X className="size-4" aria-hidden />
        </Button>
      )}
    </AriaSearchField>
  )
}
