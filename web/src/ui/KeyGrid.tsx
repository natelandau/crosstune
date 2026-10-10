import { ListBox, ListBoxItem, type Selection } from 'react-aria-components'
import { ALL_KEYS } from '../constants'
import { sameText } from '../text/fold'
import { KEY, spokenKey, UNKNOWN_KEY } from './keyName'
import { CAPSULE_HIT } from './Capsule'
import { KeyPill } from './KeyPill'

interface Choice {
  id: string
  /** The value `onChange` receives; null for the empty choice. */
  value: string | null
  name: string
  face: string
  plain: boolean
}

// No key can be the empty choice's id: keys are short note names, which never hold a NUL.
const EMPTY = '\u0000any'

/**
 * The key as a closed grid of colored pills, a single-choice list box laid out as a grid.
 * Both spellings of a black key are offered and share a hue, and a stored key the grid lacks
 * joins it as its own pill, so a key is never hidden. Each pill is named in words, as
 * "F sharp".
 *
 * The arrows move focus without choosing, and a press, Enter, or Space chooses, so a caller
 * that closes on a choice survives keyboard browsing. Pressing the chosen key clears it, as
 * every key control in the app does.
 */
export function KeyGrid({
  value,
  onChange,
  anyLabel,
  keys = ALL_KEYS,
  noKey,
  autoFocus = false,
}: {
  /** The chosen key, or null for none. */
  value: string | null
  onChange: (key: string | null) => void
  /** Leads the grid with an empty choice of this name, chosen while `value` is null. */
  anyLabel?: string
  /** The keys offered, in order. Defaults to every key spelling. */
  keys?: readonly string[]
  /** A value among `keys` that stands for tunes with no key, shown as a question mark. */
  noKey?: string
  /** Focuses the chosen pill, or the first, on mount. */
  autoFocus?: boolean
}) {
  // A stored key spelled in another case or with other accents is the grid's own pill.
  const held = value === null ? undefined : keys.find((key) => sameText(key, value))
  const offered = value === null || held !== undefined ? keys : [...keys, value]
  const choices: Choice[] = [
    ...(anyLabel === undefined
      ? []
      : [{ id: EMPTY, value: null, name: anyLabel, face: anyLabel, plain: true }]),
    ...offered.map((key) =>
      key === noKey
        ? // A question mark is the shorthand a musician writes on a tune list; it reads as
          // nothing aloud, so the pill is named in words.
          { id: key, value: key, name: UNKNOWN_KEY, face: '?', plain: true }
        : { id: key, value: key, name: spokenKey(key), face: key, plain: false },
    ),
  ]
  const chosenId = value === null ? (anyLabel === undefined ? null : EMPTY) : (held ?? value)

  const choose = (selection: Selection) => {
    if (selection === 'all') return
    const [id] = selection
    // An emptied selection is the chosen pill pressed again.
    onChange(id === undefined ? null : (choices.find((c) => c.id === id)?.value ?? null))
  }

  return (
    <ListBox
      aria-label={KEY}
      layout="grid"
      selectionMode="single"
      selectedKeys={chosenId === null ? [] : [chosenId]}
      onSelectionChange={choose}
      // Escape belongs to the popover or sheet around the grid; React Aria's default would
      // clear the chosen key first.
      escapeKeyBehavior="none"
      autoFocus={autoFocus}
      items={choices}
      className="flex flex-wrap gap-2"
    >
      {(choice) => (
        <ListBoxItem
          id={choice.id}
          textValue={choice.name}
          aria-label={choice.name}
          className={`${CAPSULE_HIT} inline-flex cursor-default rounded-(--radius-capsule)`}
        >
          {({ isSelected }) => (
            <KeyPill value={choice.face} chosen={isSelected} plain={choice.plain} flood />
          )}
        </ListBoxItem>
      )}
    </ListBox>
  )
}
