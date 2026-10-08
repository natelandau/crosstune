import { formatDuration } from '../text/format'
import { clamp } from '../math'

export const MIN_LOOP_MS = 500
export const MAX_LOOPS = 100
export const LOOP_COLOR_COUNT = 6
export const SNAP_PX = 8
export const DRAG_THRESHOLD_PX = 8
export const NEW_LOOP_PAD_MS = 4000

export type Span = { startMs: number; endMs: number }

/** A loop row's span, in the lanes' own terms. */
export function rowSpan(row: { start_ms: number; end_ms: number }): Span {
  return { startMs: row.start_ms, endMs: row.end_ms }
}

/** Only the span of something that carries one, so its other fields never ride along. */
export function spanOf(value: Span): Span {
  return { startMs: value.startMs, endMs: value.endMs }
}

/** A span as the fields a loop write takes. */
export function spanFields(span: Span): { start_ms: number; end_ms: number } {
  return { start_ms: span.startMs, end_ms: span.endMs }
}
export type Bounds = Span
export type PlacedLoop = Span & { id: string; color: number }

/** A loop row as the lanes place it. */
export function placedLoop(row: {
  id: string
  color: number
  start_ms: number
  end_ms: number
}): PlacedLoop {
  return { ...rowSpan(row), id: row.id, color: row.color }
}
/** A loop as a drag has it: `id` null for one being drawn. */
export type Draft = Span & { id: string | null }

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

export type NewLoop =
  | { kind: 'span'; span: Span }
  | { kind: 'inside'; id: string }
  | { kind: 'noRoom' }
  | { kind: 'atCap' }

/** The loop holding `ms`; a seam between flush loops belongs to the one that starts there. */
export function loopAt(ms: number, loops: readonly PlacedLoop[]): PlacedLoop | null {
  return loops.find((loop) => loop.startMs <= ms && ms < loop.endMs) ?? null
}

/** The free span around `loop`, up to its neighbors or the bounds. Loops are sorted by start. */
export function roomAround(loop: Span, loops: readonly PlacedLoop[], bounds: Bounds): Bounds {
  let startMs = bounds.startMs
  let endMs = bounds.endMs
  for (const other of loops) {
    if (other.endMs <= loop.startMs) startMs = Math.max(startMs, other.endMs)
    else if (other.startMs >= loop.endMs) endMs = Math.min(endMs, other.startMs)
  }
  return { startMs, endMs }
}

/** The free span around a point outside every loop, or null when the point is inside one. */
export function freeGap(ms: number, loops: readonly PlacedLoop[], bounds: Bounds): Bounds | null {
  if (loopAt(ms, loops)) return null
  return roomAround({ startMs: ms, endMs: ms }, loops, bounds)
}

/** Where New loop would go: padded around the playhead and held inside the free gap. */
export function newLoop(playheadMs: number, loops: readonly PlacedLoop[], bounds: Bounds): NewLoop {
  if (loops.length >= MAX_LOOPS) return { kind: 'atCap' }
  const inside = loopAt(playheadMs, loops)
  if (inside) return { kind: 'inside', id: inside.id }
  const gap = freeGap(playheadMs, loops, bounds)
  if (!gap) return { kind: 'noRoom' }
  const startMs = Math.max(gap.startMs, playheadMs - NEW_LOOP_PAD_MS)
  const endMs = Math.min(gap.endMs, playheadMs + NEW_LOOP_PAD_MS)
  if (endMs - startMs < MIN_LOOP_MS) return { kind: 'noRoom' }
  return { kind: 'span', span: { startMs, endMs } }
}

/** The next loop starting after the playhead, or the previous one starting before it, never the selected loop. */
export function adjacent(
  direction: 'previous' | 'next',
  playheadMs: number,
  loops: readonly PlacedLoop[],
  selectedId: string | null,
): PlacedLoop | null {
  if (direction === 'next') return loops.find((loop) => loop.startMs > playheadMs) ?? null
  return loops.findLast((loop) => loop.startMs < playheadMs && loop.id !== selectedId) ?? null
}
