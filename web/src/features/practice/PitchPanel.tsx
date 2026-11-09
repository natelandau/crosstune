import { useState } from 'react'
import { Slider } from '../../ui/Slider'
import { Stepper } from '../../ui/Stepper'
import { PITCH_LABEL, PITCH_UNAVAILABLE } from '../player/transportCopy'
import { clampPitch } from './panel'
import { ResetButton } from './ResetButton'

export const PITCH = PITCH_LABEL
export const SEMITONES = 'Semitones'
export const CENTS = 'Cents'
export const PITCH_DOWN = 'Down a semitone'
export const PITCH_UP = 'Up a semitone'
export const CENTS_DOWN = 'Down a cent'
export const CENTS_UP = 'Up a cent'
export const PITCH_PAUSES_ON_LOCK = 'Pitch-shifted playback pauses when the screen locks.'

const MAX_SEMITONES = 12
const MAX_CENTS = 50
const CENTS_LARGE_STEP = 10

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
  /** The engine could not build its audio stage, so a shift will not be heard. */
  unavailable?: boolean
  /** Says that pitch-shifted playback pauses when the screen locks, as it does on iOS. */
  lockNotice?: boolean
}) {
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
        <span className="t-secondary">{SEMITONES}</span>
        <Stepper
          label={SEMITONES}
          value={semitones}
          min={-MAX_SEMITONES}
          max={MAX_SEMITONES}
          format={signed}
          decrementLabel={PITCH_DOWN}
          incrementLabel={PITCH_UP}
          onChange={(next) => combine(next, cents)}
        />
      </div>
      <Slider
        label={CENTS}
        value={cents}
        min={-MAX_CENTS}
        max={MAX_CENTS}
        step={1}
        largeStep={CENTS_LARGE_STEP}
        detent={0}
        format={signed}
        decrementLabel={CENTS_DOWN}
        incrementLabel={CENTS_UP}
        onChange={(next) => combine(semitones, next)}
      />
      <div className="flex items-center justify-end">
        <ResetButton atDefault={value === 0} onReset={() => onChange(0)} />
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
