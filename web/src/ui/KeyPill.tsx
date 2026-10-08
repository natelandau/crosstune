import type { CSSProperties } from 'react'
import { pitchClass } from './keyColor'

const BASE =
  'inline-flex shrink-0 items-center rounded-full bg-(--pill-bg) text-(--pill-ink) tabular-nums'
// Matches a Capsule's visual height. A pill is not a control, so a control that wraps one owns
// the hit area.
const FULL = 'min-h-[min(2rem,var(--target-filter))] px-3 t-body'
const COMPACT = 'h-[22px] px-2 t-caption in-[html[data-density=pointer]]:h-[18px]'

function pillColors(pitch: number | null, chosen: boolean): CSSProperties {
  if (pitch === null) {
    return chosen
      ? ({ '--pill-bg': 'var(--slate)', '--pill-ink': 'var(--on-slate)' } as CSSProperties)
      : ({ '--pill-bg': 'var(--fill)', '--pill-ink': 'var(--ink)' } as CSSProperties)
  }
  const on = chosen ? 'on-' : ''
  return {
    '--pill-bg': `var(--key-${pitch}-${on}bg)`,
    '--pill-ink': `var(--key-${pitch}-${on}ink)`,
  } as CSSProperties
}

/**
 * A musical key as a colored pill. The hue comes from the key's pitch class, so one key looks
 * the same everywhere and two spellings of one pitch look alike. Text that is not a pitch
 * class keeps the pill on the neutral fill rather than borrowing a hue.
 */
export function KeyPill({
  value,
  chosen = false,
  compact = false,
  suffix = '',
  plain = false,
}: {
  value: string
  chosen?: boolean
  /** Sits in a row of metadata rather than standing on its own as a control. */
  compact?: boolean
  /** Text after the key, such as a mode abbreviation. The hue still comes from the key alone. */
  suffix?: string
  /** Text that is not a key, such as a grid's Any, which never takes a key's hue. */
  plain?: boolean
}) {
  const text = value.trim()
  if (!text) return null
  const pitch = plain ? null : pitchClass(text)
  return (
    <span
      className={`${BASE} ${compact ? COMPACT : FULL}`}
      style={pillColors(pitch, chosen)}
      data-pitch={pitch === null ? undefined : pitch}
      data-chosen={chosen ? '' : undefined}
    >
      {text}
      {suffix}
    </span>
  )
}
