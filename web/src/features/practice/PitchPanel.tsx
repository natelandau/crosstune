import { Minus, Plus } from 'lucide-react'
import { useId, useState } from 'react'
import { PITCH_LABEL, PITCH_UNAVAILABLE } from '../player/transportCopy'
import { clampPitch, PANEL_ICON_BUTTON, PANEL_TEXT_BUTTON, RESET } from './panel'

export const PITCH = PITCH_LABEL
export const SEMITONES = 'Semitones'
export const CENTS = 'Cents'
export const PITCH_DOWN = 'Down a semitone'
export const PITCH_UP = 'Up a semitone'
export const PITCH_PAUSES_ON_LOCK = 'Pitch-shifted playback pauses when the screen locks.'

const MAX_SEMITONES = 12
const MAX_CENTS = 50

// The true minus, as the pitch badge writes it.
function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `\u2212${-n}` : '0'
}

/**
 * The whole semitones in `cents`, a half going toward zero, so the cents beyond them stay
 * within -50 to +50: 250 is +2 and +50, and -250 is -2 and -50.
 */
function splitSemitones(cents: number): number {
  const whole = Math.floor((Math.abs(cents) + 49) / 100)
  return cents < 0 && whole !== 0 ? -whole : whole
}

/**
 * Pitch shift with speed held, shown as whole semitones plus up to 50 cents either way and
 * stored as one number of cents.
 */
export function PitchPanel({
  value,
  onChange,
  unavailable = false,
  lockNotice = false,
}: {
  value: number
  onChange: (cents: number) => void
  /** The engine could not build its pitch stage, so a shift will not be heard. */
  unavailable?: boolean
  /** Says that pitch-shifted playback pauses when the screen locks, as it does on iOS. */
  lockNotice?: boolean
}) {
  const semitonesId = useId()
  const centsId = useId()
  // A pitch on a half semitone splits two ways (+2 and +50 cents, or +3 and -50), so the
  // panel keeps the split the musician chose and splits afresh only for a pitch from elsewhere.
  const [split, setSplit] = useState({ value, semitones: splitSemitones(value) })
  if (split.value !== value) setSplit({ value, semitones: splitSemitones(value) })
  const semitones = split.value === value ? split.semitones : splitSemitones(value)
  const cents = value - semitones * 100
  const combine = (nextSemitones: number, nextCents: number) => {
    const next = clampPitch(nextSemitones * 100 + nextCents)
    // A clamped pitch keeps its cents inside -50 to +50 only under a fresh split.
    const kept = Math.abs(next - nextSemitones * 100) <= MAX_CENTS
    setSplit({ value: next, semitones: kept ? nextSemitones : splitSemitones(next) })
    onChange(next)
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <span id={semitonesId} className="t-secondary">
          {SEMITONES}
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label={PITCH_DOWN}
            className={PANEL_ICON_BUTTON}
            disabled={semitones <= -MAX_SEMITONES}
            onClick={() => combine(semitones - 1, cents)}
          >
            <Minus aria-hidden="true" className="size-5" />
          </button>
          <output aria-labelledby={semitonesId} className="t-heading w-10 text-center tabular-nums">
            {signed(semitones)}
          </output>
          <button
            type="button"
            aria-label={PITCH_UP}
            className={PANEL_ICON_BUTTON}
            disabled={semitones >= MAX_SEMITONES}
            onClick={() => combine(semitones + 1, cents)}
          >
            <Plus aria-hidden="true" className="size-5" />
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <label htmlFor={centsId} className="t-secondary">
          {CENTS}
        </label>
        <span className="t-secondary tabular-nums">{signed(cents)}</span>
      </div>
      <input
        id={centsId}
        type="range"
        min={-MAX_CENTS}
        max={MAX_CENTS}
        step={1}
        value={cents}
        className="h-11 w-full accent-(--panel-ink)"
        onChange={(event) => combine(semitones, Number(event.target.value))}
      />
      <div className="flex items-center justify-end">
        <button
          type="button"
          className={PANEL_TEXT_BUTTON}
          disabled={value === 0}
          onClick={() => onChange(0)}
        >
          {RESET}
        </button>
      </div>
      {/* Hidden rather than absent, so the panel's height never changes with the engine. */}
      <p
        role="status"
        aria-hidden={unavailable ? undefined : 'true'}
        className={`t-secondary ${unavailable ? '' : 'invisible'}`}
      >
        {PITCH_UNAVAILABLE}
      </p>
      {lockNotice ? <p className="t-secondary">{PITCH_PAUSES_ON_LOCK}</p> : null}
    </div>
  )
}
