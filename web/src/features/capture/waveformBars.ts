export const BAR_WIDTH = 3
export const BAR_GAP = 2
export const MIN_BAR = 2
const GAIN = 2.5

export interface Bar {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The levels behind a waveform. Scrolling keeps the newest level at the right edge; fixed keeps
 * one slot per bar and overwrites them in turn, so the level shows without horizontal travel.
 */
export interface WaveformLevels {
  mode: 'scrolling' | 'fixed'
  levels: number[]
  /** The fixed slot the next level is written to. */
  cursor: number
}

export function createLevels(mode: WaveformLevels['mode']): WaveformLevels {
  return { mode, levels: [], cursor: 0 }
}

export function barCount(width: number): number {
  return Math.max(0, Math.ceil(width / (BAR_WIDTH + BAR_GAP)))
}

/** Root mean square of 8-bit time-domain samples, from 0 for silence to 1 at full scale. */
export function rmsLevel(samples: Uint8Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (const v of samples) sum += (v - 128) ** 2
  return Math.sqrt(sum / samples.length) / 128
}

export function pushLevel(state: WaveformLevels, level: number, capacity: number): void {
  if (capacity <= 0) return
  if (state.mode === 'scrolling') {
    state.levels.push(level)
    if (state.levels.length > capacity) state.levels.splice(0, state.levels.length - capacity)
    return
  }
  // A resize changes the slot count; keep what still fits and restart the cursor inside it.
  if (state.levels.length !== capacity) {
    state.levels = Array.from({ length: capacity }, (_, i) => state.levels[i] ?? 0)
    state.cursor %= capacity
  }
  state.levels[state.cursor] = level
  state.cursor = (state.cursor + 1) % capacity
}

/**
 * Visits each bar's box in order. A callback rather than an array, since a live waveform draws
 * every animation frame and should leave no garbage behind it.
 */
export function eachBar(
  state: WaveformLevels,
  width: number,
  height: number,
  visit: (x: number, y: number, width: number, height: number) => void,
): void {
  const step = BAR_WIDTH + BAR_GAP
  const count = state.levels.length
  for (let i = 0; i < count; i++) {
    const bar = Math.min(height, Math.max(MIN_BAR, state.levels[i]! * height * GAIN))
    const x = state.mode === 'scrolling' ? width - (count - i) * step : i * step
    visit(x, (height - bar) / 2, BAR_WIDTH, bar)
  }
}
