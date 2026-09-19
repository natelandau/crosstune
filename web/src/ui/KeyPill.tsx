import { pitchClass } from './keyColor'

const BASE = 'key-pill inline-flex shrink-0 items-center rounded-full tabular-nums'
/** Sized to fill a 44px tap target, for a rail the musician presses. */
const FULL = 'min-h-8 px-3 type-subheadline'
/** Sized to sit inside a line of row metadata without setting that row's height. */
const COMPACT = 'min-h-6 px-2 type-footnote'

/**
 * A musical key as a colored pill. The hue comes from the key's pitch class, so one key looks
 * the same everywhere it appears and two spellings of one pitch look alike. Text the app cannot
 * read as a pitch class keeps the pill and takes the neutral fill rather than borrowing a hue.
 */
export function KeyPill({
  value,
  chosen = false,
  compact = false,
}: {
  value: string
  chosen?: boolean
  /** Sits in a row of metadata rather than standing on its own as a control. */
  compact?: boolean
}) {
  const text = value.trim()
  if (!text) return null
  const pitch = pitchClass(text)
  return (
    <span
      className={`${BASE} ${compact ? COMPACT : FULL}`}
      data-pitch={pitch === null ? undefined : pitch}
      data-chosen={chosen ? '' : undefined}
    >
      {text}
    </span>
  )
}
