/** The waveform peaks file: one byte per 20 ms window, the amplitude both clients draw. */

export const PEAKS_VERSION = 1
export const PEAKS_PER_SECOND = 50
const HEADER_SIZE = 3
const MS_PER_WINDOW = 1000 / PEAKS_PER_SECOND

export interface Peaks {
  pointsPerSecond: number
  /** A view into the file it was parsed from, shared rather than copied: never write to it. */
  values: Uint8Array
}

/** Prefix raw per-window peak bytes with the format header. */
export function encodePeaks(values: Uint8Array): Uint8Array {
  const file = new Uint8Array(HEADER_SIZE + values.length)
  file[0] = PEAKS_VERSION
  file[1] = (PEAKS_PER_SECOND >> 8) & 0xff
  file[2] = PEAKS_PER_SECOND & 0xff
  file.set(values, HEADER_SIZE)
  return file
}

/** Check the header and return the points-per-second and raw per-window peak bytes. */
export function parsePeaks(file: Uint8Array): Peaks {
  if (file.length < HEADER_SIZE) {
    throw new Error(`Peaks header needs ${HEADER_SIZE} bytes, got ${file.length}`)
  }
  const version = file[0]
  const pointsPerSecond = ((file[1] ?? 0) << 8) | (file[2] ?? 0)
  if (version !== PEAKS_VERSION || pointsPerSecond !== PEAKS_PER_SECOND) {
    throw new Error(
      `Unsupported peaks header: version=${version}, pointsPerSecond=${pointsPerSecond}`,
    )
  }
  return { pointsPerSecond, values: file.subarray(HEADER_SIZE) }
}

/** Cut a full peaks file down to the `startMs` to `endMs` range of its own file. */
export function slicePeaks(peaks: Peaks, startMs: number, endMs: number): Peaks {
  const start = Math.floor((startMs * peaks.pointsPerSecond) / 1000)
  const end = Math.floor((endMs * peaks.pointsPerSecond) / 1000)
  return { pointsPerSecond: peaks.pointsPerSecond, values: peaks.values.subarray(start, end) }
}

/**
 * Resample captured peak bytes to `round(durationMs / 20)` points, taking the max of each
 * target window. Capture ticks drift from the ideal 20 ms cadence, so the raw count rarely
 * lines up with the final duration.
 */
export function fitPeaks(values: Uint8Array, durationMs: number): Uint8Array {
  const targetCount = Math.round(durationMs / MS_PER_WINDOW)
  const out = new Uint8Array(targetCount)
  const total = values.length
  for (let t = 0; t < targetCount; t++) {
    const start = Math.floor((t * total) / targetCount)
    const end = Math.floor(((t + 1) * total) / targetCount)
    let peak = 0
    for (let i = start; i < end; i++) {
      const v = values[i]!
      if (v > peak) peak = v
    }
    out[t] = peak
  }
  return out
}

/** Scale the largest magnitude sample of a 20 ms window to a byte, 0 to 255 at full scale. */
export function peakByte(samples: Float32Array): number {
  let peak = 0
  for (const sample of samples) {
    const abs = Math.abs(sample)
    if (abs > peak) peak = abs
  }
  return Math.round(Math.min(peak, 1) * 255)
}

/** The largest value in a run of peaks, 0 for none. */
export function loudestPeak(values: Uint8Array): number {
  let loudest = 0
  for (const v of values) if (v > loudest) loudest = v
  return loudest
}

/**
 * One level per bar, from 0 to 1: the loudest point each bar covers, scaled to `loudest` so a
 * quiet recording still fills the height. A slice passes its whole file's loudest point, so
 * trimming never rescales what stays. With fewer points than bars, a point spans several bars.
 */
export function barLevels(
  values: Uint8Array,
  count: number,
  loudest: number = loudestPeak(values),
): number[] {
  const total = values.length
  const levels: number[] = []
  for (let bar = 0; bar < count; bar++) {
    if (loudest === 0) {
      levels.push(0)
      continue
    }
    const start = Math.floor((bar * total) / count)
    const end = Math.min(total, Math.max(start + 1, Math.floor(((bar + 1) * total) / count)))
    let peak = 0
    for (let i = start; i < end; i++) {
      const v = values[i]!
      if (v > peak) peak = v
    }
    levels.push(Math.min(1, peak / loudest))
  }
  return levels
}
