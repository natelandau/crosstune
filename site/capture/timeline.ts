import { mapPoint } from './crop.ts'
import type { CropRect } from './crop.ts'
import type { Tap, Timeline, Window } from './types.ts'

/** The fingertip dot's size in output pixels. */
export const DOT = 72

const TAP_SHOWN = 0.45
const BEFORE_TAP = 0.5
const AFTER_TAP = 1.8
export const TAIL = 3

/** Times go into ffmpeg filter text, so float noise like 0.6000000000000227 is rounded off. */
const seconds = (value: number) => Number(value.toFixed(3))

/** The scene's bounds in seconds from the recording's start. */
export function trimArgs(t: Timeline, recordingStart: number): Window {
  return { ss: t.start - recordingStart, to: t.end - recordingStart }
}

/**
 * The stretches of the recording a clip keeps: a window around each tap and a tail after the
 * last, merged where they overlap, so idle waits between steps become jump cuts. With no taps
 * the whole scene is kept. A window that starts after the file's last frame would show only
 * that frame held, which the tail already shows, so it is dropped. Each of `spans` names two
 * taps by index whose whole stretch is kept, for action that must read without a cut.
 */
export function keepWindows(
  t: Timeline,
  recordingStart: number,
  recordingDuration: number,
  tail = TAIL,
  spans: [number, number][] = [],
): Window[] {
  const scene = trimArgs(t, recordingStart)
  const clamp = (w: Window): Window => ({
    ss: Math.max(scene.ss, w.ss),
    to: Math.min(scene.to, w.to),
  })
  if (t.taps.length === 0) return [scene]

  const times = t.taps.map((tap) => tap.t - recordingStart).sort((a, b) => a - b)
  const last = times[times.length - 1]
  const windows = [
    ...times.map((at) => clamp({ ss: at - BEFORE_TAP, to: at + AFTER_TAP })),
    ...spans.map(([from, to]) =>
      clamp({ ss: times[from] - BEFORE_TAP, to: times[to] + AFTER_TAP }),
    ),
    clamp({ ss: last, to: last + tail }),
  ].sort((a, b) => a.ss - b.ss)

  const merged: Window[] = []
  for (const w of windows) {
    const previous = merged[merged.length - 1]
    if (previous && w.ss <= previous.to) previous.to = Math.max(previous.to, w.to)
    else merged.push({ ...w })
  }
  return merged.filter((w) => w.to > w.ss && w.ss < recordingDuration)
}

/**
 * Moves tap times into the clip that concatenates `windows`, dropping taps that fall in a cut.
 * `offset` nudges every dot later (or earlier) when the recording's start time is off.
 */
export function remapTaps(
  taps: Tap[],
  windows: Window[],
  recordingStart: number,
  offset = 0,
): Tap[] {
  const result: Tap[] = []
  for (const tap of taps) {
    const at = tap.t - recordingStart
    let elapsed = 0
    for (const w of windows) {
      if (at >= w.ss && at <= w.to) {
        result.push({ ...tap, t: Math.max(0, elapsed + at - w.ss + offset) })
        break
      }
      elapsed += w.to - w.ss
    }
  }
  return result
}

/**
 * The filter graph from `[v]` (the cut clip at source size) to `[out]`: cropped to `crop` when
 * given, scaled to `outWidth`, with a soft dot from input 1 over each tap for a moment. Taps
 * outside the crop get no dot. Tap times count from `t.start`.
 */
export function tapFilter(
  t: Timeline,
  sourceWidth: number,
  outWidth: number,
  crop?: CropRect,
): string {
  const cut = crop ? `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},` : ''
  const scaled = `[v]${cut}scale=${outWidth}:-2`
  const ratio = outWidth / (crop?.w ?? sourceWidth)
  const dots = t.taps.flatMap((tap) => {
    const at = crop ? mapPoint(tap, crop, t.scale) : { x: tap.x * t.scale, y: tap.y * t.scale }
    return at ? [{ t: tap.t, x: at.x, y: at.y }] : []
  })
  if (dots.length === 0) return `${scaled}[out]`

  const last = dots.length - 1
  const split = dots.map((_, i) => `[d${i}]`).join('')
  const overlays = dots.map((dot, i) => {
    const from = seconds(dot.t - t.start)
    const x = Math.round(dot.x * ratio - DOT / 2)
    const y = Math.round(dot.y * ratio - DOT / 2)
    const input = i === 0 ? '[s]' : `[o${i - 1}]`
    const output = i === last ? '[out]' : `[o${i}]`
    const enable = `enable='between(t,${from},${seconds(from + TAP_SHOWN)})'`
    return `${input}[d${i}]overlay=x=${x}:y=${y}:${enable}${output}`
  })
  return [`${scaled}[s]`, `[1:v]split=${dots.length}${split}`, ...overlays].join(';')
}
