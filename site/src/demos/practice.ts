// The practice player's state rules, kept apart from the DOM so they can be tested.

export const SPEED = { min: 50, max: 150, step: 5, initial: 100 } as const
export const PITCH = { min: -12, max: 12, initial: 0 } as const
export const LOOP_STEP = 0.5
export const MIN_LOOP = 1
export const INITIAL_LOOP = { a: 8, b: 14 } as const
export const DETECTED_KEY = 'A'

export interface Loop {
  a: number
  b: number
}

export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/**
 * Moves one handle and keeps the loop valid: A before B, at least MIN_LOOP apart, both inside
 * the clip. The moved handle gives way; the other never moves.
 */
export function moveHandle(loop: Loop, handle: 'a' | 'b', to: number, duration: number): Loop {
  if (handle === 'a') return { ...loop, a: clamp(to, 0, loop.b - MIN_LOOP) }
  return { ...loop, b: clamp(to, loop.a + MIN_LOOP, duration) }
}

/** Where playback continues from: back to A once it reaches B while looping. */
export function wrapTime(time: number, loop: Loop, looping: boolean): number {
  return looping && time >= loop.b ? loop.a : time
}

/** Semitones the stretch node adds to cancel the shift the element's own rate applies. */
export function compensatedSemitones(semitones: number, speedPercent: number): number {
  return semitones - 12 * Math.log2(speedPercent / 100)
}

export function speedCaption(percent: number): string {
  if (percent === 100) return '100%: the speed it was played.'
  return `${percent}%: ${percent < 100 ? 'slower' : 'faster'}, same pitch.`
}

export function pitchCaption(semitones: number): string {
  if (semitones === 0) return 'Original pitch.'
  const size = Math.abs(semitones)
  const amount = size === 1 ? 'a semitone' : `${size} semitones`
  return `${semitones > 0 ? 'Up' : 'Down'} ${amount}, same speed.`
}

export function loopCaption(loop: Loop, looping: boolean): string {
  if (!looping) return 'Loop off: it plays straight through.'
  return `Looping ${formatTime(loop.a)} to ${formatTime(loop.b)}.`
}

/** After a handle moves: the loop it would play, and how to hear it if Loop is off. */
export function handleCaption(loop: Loop, looping: boolean): string {
  if (looping) return loopCaption(loop, true)
  return `Loop set to ${formatTime(loop.a)} to ${formatTime(loop.b)}. Turn on Loop to repeat it.`
}

export const PLAYER_REST =
  '30 seconds of Bibb County Hoedown, played by the Strung Out String Band.'
export const PLAYER_PROMPT = 'Press play, then try the speed, the pitch, and the loop.'
export const PITCH_UNAVAILABLE = "This browser can't shift pitch; speed and loop still work."
export const PITCH_DOWN = 'Down a semitone'
export const PITCH_UP = 'Up a semitone'
export const PLAY = 'Play'
export const PAUSE = 'Pause'
export const LOADING_PITCH = 'Loading pitch shift…'
export const REST_LINE =
  'A metronome counts you in, and speed, pitch, and loop stay with the recording on every device.'

export const signed = (n: number) => (n > 0 ? `+${n}` : String(n))

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
