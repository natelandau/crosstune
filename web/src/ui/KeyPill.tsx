import { pitchClass } from './keyColor'

const BASE =
  'key-pill inline-flex min-h-8 shrink-0 items-center rounded-full px-3 type-subheadline tabular-nums'

/**
 * A musical key as a colored pill. The hue comes from the key's pitch class, so one key looks
 * the same everywhere it appears and two spellings of one pitch look alike. Text the app cannot
 * read as a pitch class keeps the pill and takes the neutral fill rather than borrowing a hue.
 */
export function KeyPill({ value, chosen = false }: { value: string; chosen?: boolean }) {
  const text = value.trim()
  if (!text) return null
  const pitch = pitchClass(text)
  return (
    <span
      className={BASE}
      data-pitch={pitch === null ? undefined : pitch}
      data-chosen={chosen ? '' : undefined}
    >
      {text}
    </span>
  )
}
