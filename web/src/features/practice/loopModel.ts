import { LOOP_LIMIT } from '../../commands/messages'
import { formatDuration } from '../recording/format'
import { clamp } from '../../math'

export const MIN_LOOP_MS = 500
export const MAX_LOOPS = 100
export const LOOP_COLOR_COUNT = 6
export const SNAP_PX = 8
export const DRAG_THRESHOLD_PX = 8

export type Span = { startMs: number; endMs: number }
export type Bounds = Span
export type PlacedLoop = Span & { id: string; color: number }

/** The span between an anchor and a pointer, widened to the minimum length and held inside the bounds. */
export function spanFromDrag(anchorMs: number, pointerMs: number, bounds: Bounds): Span {
  const lo = clamp(Math.min(anchorMs, pointerMs), bounds.startMs, bounds.endMs)
  const hi = clamp(Math.max(anchorMs, pointerMs), bounds.startMs, bounds.endMs)
  if (hi - lo >= MIN_LOOP_MS) return { startMs: lo, endMs: hi }
  const endMs = Math.min(lo + MIN_LOOP_MS, bounds.endMs)
  return { startMs: endMs - MIN_LOOP_MS, endMs }
}

/** Slides a span by a delta, keeping its length and stopping at the bounds. */
export function moveSpan(span: Span, deltaMs: number, bounds: Bounds): Span {
  const delta = clamp(deltaMs, bounds.startMs - span.startMs, bounds.endMs - span.endMs)
  return { startMs: span.startMs + delta, endMs: span.endMs + delta }
}

/** Drags one edge to a new time, keeping the minimum length and staying inside the bounds. */
export function resizeSpan(span: Span, edge: 'start' | 'end', toMs: number, bounds: Bounds): Span {
  if (edge === 'start') {
    return {
      startMs: clamp(toMs, bounds.startMs, span.endMs - MIN_LOOP_MS),
      endMs: span.endMs,
    }
  }
  return {
    startMs: span.startMs,
    endMs: clamp(toMs, span.startMs + MIN_LOOP_MS, bounds.endMs),
  }
}

/** Snaps to the nearest target within SNAP_PX on screen; otherwise returns the time unchanged. */
export function snapMs(ms: number, targets: readonly number[], msPerPx: number): number {
  const reach = SNAP_PX * msPerPx
  let best = ms
  let bestDistance = Infinity
  for (const target of targets) {
    const distance = Math.abs(target - ms)
    if (distance <= reach && distance < bestDistance) {
      best = target
      bestDistance = distance
    }
  }
  return best
}

const byPosition = (a: PlacedLoop, b: PlacedLoop) =>
  a.startMs - b.startMs || a.endMs - b.endMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** Greedy interval partitioning: each loop takes the lowest row that is free by its start. */
export function stackRows(loops: readonly PlacedLoop[]): Map<string, number> {
  const rows = new Map<string, number>()
  const rowEnds: number[] = []
  for (const loop of [...loops].sort(byPosition)) {
    let row = rowEnds.findIndex((end) => end <= loop.startMs)
    if (row === -1) row = rowEnds.length
    rowEnds[row] = loop.endMs
    rows.set(loop.id, row)
  }
  return rows
}

/** The color slot least used among nearby loops, then across all loops, then lowest index. */
export function pickColor(span: Span, loops: readonly PlacedLoop[]): number {
  const neighbors = new Set<PlacedLoop>()
  let before: PlacedLoop | null = null
  let after: PlacedLoop | null = null
  for (const loop of [...loops].sort(byPosition)) {
    if (loop.startMs < span.endMs && span.startMs < loop.endMs) {
      neighbors.add(loop)
    } else if (loop.endMs <= span.startMs) {
      if (before === null || loop.endMs > before.endMs) before = loop
    } else if (loop.startMs >= span.endMs) {
      if (after === null || loop.startMs < after.startMs) after = loop
    }
  }
  if (before) neighbors.add(before)
  if (after) neighbors.add(after)

  const count = (set: Iterable<PlacedLoop>) => {
    const counts = new Array<number>(LOOP_COLOR_COUNT).fill(0)
    for (const loop of set) {
      if (loop.color >= 0 && loop.color < LOOP_COLOR_COUNT) counts[loop.color]! += 1
    }
    return counts
  }
  const nearby = count(neighbors)
  const overall = count(loops)

  let best = 0
  for (let slot = 1; slot < LOOP_COLOR_COUNT; slot++) {
    if (
      nearby[slot]! < nearby[best]! ||
      (nearby[slot] === nearby[best] && overall[slot]! < overall[best]!)
    ) {
      best = slot
    }
  }
  return best
}

/** "<L> part" for each distinct letter of a part structure, with labels already in use last. */
export function partSuggestions(
  partStructure: string | null,
  usedLabels: readonly string[],
): string[] {
  if (!partStructure) return []
  // Parenthesized text is a repeat note such as "(x3)", not parts.
  // Letters are matched before uppercasing, since some (ß) uppercase to more than one letter.
  const letters = partStructure.replace(/\([^)]*\)/g, '').match(/[A-Za-z]/g) ?? []
  const labels = [...new Set(letters.map((l) => l.toUpperCase()))].map((letter) => `${letter} part`)
  const used = new Set(usedLabels)
  return [...labels.filter((l) => !used.has(l)), ...labels.filter((l) => used.has(l))]
}

export function loopName(label: string | null, startMs: number, trimStartMs: number): string {
  if (label !== null && label.trim() !== '') return label
  return `Loop ${formatDuration(startMs - trimStartMs)}`
}

export function canCreate(
  liveCount: number,
  bounds: Bounds,
): { allowed: boolean; reason: string | null } {
  if (liveCount >= MAX_LOOPS) return { allowed: false, reason: LOOP_LIMIT }
  if (bounds.endMs - bounds.startMs < MIN_LOOP_MS) return { allowed: false, reason: null }
  return { allowed: true, reason: null }
}
