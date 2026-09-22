import { ALL_KEYS, QUICK_KEYS } from '../../constants'
import { Capsule, PressTarget } from '../../ui/Capsule'
import { KeyPill } from '../../ui/KeyPill'
import { useMenu } from '../../ui/Menu'

export const MORE_KEYS = 'More keys…'
export const UNKNOWN_KEY = 'Unknown key'

const isQuick = (key: string) => (QUICK_KEYS as readonly string[]).includes(key)

/**
 * The key as a grid of pills, in the colors every other screen already shows a key in. Key is
 * the one closed vocabulary in the form: there are twelve pitch classes and no thirteenth, so
 * nothing is typed here and More keys… opens the rest rather than a text field.
 *
 * A value the grid does not hold, whether picked from that menu or written by an older client,
 * joins the grid as its own pill, so a key is never hidden and never silently dropped.
 */
export function KeyChooser({
  value,
  onChange,
  emptyLabel = UNKNOWN_KEY,
}: {
  /** The stored key, or an empty string for a song with no key. */
  value: string
  /** Receives an empty string when the empty choice or the chosen key is pressed. */
  onChange: (value: string) => void
  /** The empty choice's accessible name, for a caller whose empty means something other than
   * an unknown key. */
  emptyLabel?: string
}) {
  const openMenu = useMenu()
  const chosen = value.trim()
  const shown: readonly string[] =
    chosen === '' || isQuick(chosen) ? QUICK_KEYS : [...QUICK_KEYS, chosen]
  const rest = ALL_KEYS.filter((key) => !shown.includes(key))

  return (
    <div role="group" aria-label="Key" className="flex flex-wrap gap-1.5 px-(--form-gutter)">
      {/* A question mark sits in a row of single letters as the shorthand a musician already
          writes on a tune list. It reads as nothing aloud, so the chip is named in words. */}
      <Capsule pressed={chosen === ''} onPress={() => onChange('')} label={emptyLabel}>
        ?
      </Capsule>
      {shown.map((key) => (
        <PressTarget
          key={key}
          pressed={chosen === key}
          label={key}
          // Pressing the chosen key clears it, the way the catalog's own key rail does.
          onPress={() => onChange(chosen === key ? '' : key)}
        >
          <KeyPill value={key} chosen={chosen === key} />
        </PressTarget>
      ))}
      <Capsule
        label={MORE_KEYS}
        onPressEvent={(event) =>
          openMenu(
            event,
            'More keys',
            rest.map((key) => ({ label: key, onPress: () => onChange(key) })),
          )
        }
      >
        {MORE_KEYS}
      </Capsule>
    </div>
  )
}
