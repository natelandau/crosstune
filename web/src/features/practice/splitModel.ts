import type { RecordingFile } from '../../db/recordings'
import type { LocalRecording } from '../../db/types'
import {
  MAX_RECORDING_MS,
  MAX_SPLIT_PIECES,
  MIN_KEPT_MS,
  pieceProblem,
  splitRangeEnd,
} from '../../domain/recordingLimits'
import { clamp } from '../../math'
import { LOOP_COLOR_COUNT, LOOP_COLOR_ORDER } from '../../domain/loopModel'

/** Every value in ms on the source timeline. */
export interface SplitState {
  /** The row's current trim, which the cuts cannot leave. */
  lowMs: number
  highMs: number
  lineMs: number
  /** Ascending. */
  cuts: number[]
  /** Index into `cuts`; the line moves that cut instead of only itself. A new cut starts selected,
   * so Remove cut undoes it at once. */
  selected: number | null
  /** The whole range is over `MAX_RECORDING_MS`, so every piece must fit it. */
  overLimit: boolean
}

export type SplitAction =
  | { type: 'moveLine'; ms: number }
  | { type: 'nudge'; ms: number }
  /** Moves the line alone, letting go of a selected cut, as a tap on the whole recording does. */
  | { type: 'seek'; ms: number }
  /** The line has stopped; one resting exactly on a cut selects it. */
  | { type: 'rest' }
  | { type: 'addCut' }
  | { type: 'removeCut' }
  | { type: 'select'; index: number }
  /** Moves cut `index` alone, as its handle does, leaving the line where it is. */
  | { type: 'moveCut'; index: number; ms: number }
  | { type: 'previous' }
  | { type: 'next' }

type SplitRow = Pick<
  LocalRecording,
  'trim_start_ms' | 'trim_end_ms' | 'source_duration_ms' | 'duration_ms'
>

/** The row's current trim, with the end found in the same order the split command uses. */
export function initialSplit(
  row: SplitRow,
  file: Pick<RecordingFile, 'local_duration_ms'> | undefined,
): SplitState {
  const lowMs = row.trim_start_ms
  const highMs = Math.max(lowMs, splitRangeEnd(row, file) ?? lowMs)
  return {
    lowMs,
    highMs,
    lineMs: lowMs,
    cuts: [],
    selected: null,
    overLimit: highMs - lowMs > MAX_RECORDING_MS,
  }
}

/** The range a cut at `index` (or a new cut, when null) may sit in. */
export function cutRoom(state: SplitState, index: number | null): [number, number] {
  const at = index ?? pieceAt(state, state.lineMs)
  const before = at === 0 ? state.lowMs : state.cuts[at - 1]!
  const after =
    index === null ? (state.cuts[at] ?? state.highMs) : (state.cuts[at + 1] ?? state.highMs)
  return [before + MIN_KEPT_MS, after - MIN_KEPT_MS]
}

export function canAddCut(state: SplitState): boolean {
  if (state.selected !== null || state.cuts.length + 1 >= MAX_SPLIT_PIECES) return false
  const [min, max] = cutRoom(state, null)
  return state.lineMs >= min && state.lineMs <= max
}

function moveTo(state: SplitState, ms: number): SplitState {
  if (state.selected === null) {
    return { ...state, lineMs: Math.round(clamp(ms, state.lowMs, state.highMs)) }
  }
  const [min, max] = cutRoom(state, state.selected)
  if (min > max) return state
  const cut = Math.round(clamp(ms, min, max))
  const cuts = state.cuts.map((c, i) => (i === state.selected ? cut : c))
  return { ...state, cuts, lineMs: cut }
}

function selectCut(state: SplitState, index: number): SplitState {
  const cut = state.cuts[index]
  return cut === undefined ? state : { ...state, selected: index, lineMs: cut }
}

export function splitReducer(state: SplitState, action: SplitAction): SplitState {
  switch (action.type) {
    case 'moveLine':
      return moveTo(state, action.ms)
    case 'nudge':
      return moveTo(state, state.lineMs + action.ms)
    case 'seek':
      return moveTo({ ...state, selected: null }, action.ms)
    case 'rest': {
      if (state.selected !== null) return state
      const at = state.cuts.indexOf(state.lineMs)
      return at < 0 ? state : { ...state, selected: at }
    }
    case 'addCut': {
      if (!canAddCut(state)) return state
      const cuts = [...state.cuts, state.lineMs].sort((a, b) => a - b)
      return { ...state, cuts, selected: cuts.indexOf(state.lineMs) }
    }
    case 'removeCut': {
      if (state.selected === null) return state
      return { ...state, cuts: state.cuts.filter((_, i) => i !== state.selected), selected: null }
    }
    case 'select':
      return selectCut(state, action.index)
    case 'moveCut': {
      const [min, max] = cutRoom(state, action.index)
      if (min > max || state.cuts[action.index] === undefined) return state
      const cut = Math.round(clamp(action.ms, min, max))
      if (cut === state.cuts[action.index]) return state
      const cuts = state.cuts.map((c, i) => (i === action.index ? cut : c))
      // A selected cut holds the line on it, so moving it away lets it go.
      const selected = state.selected === action.index ? null : state.selected
      return { ...state, cuts, selected }
    }
    case 'previous': {
      const from = state.selected ?? state.cuts.filter((cut) => cut < state.lineMs).length
      return from > 0 ? selectCut(state, from - 1) : state
    }
    case 'next': {
      const from =
        state.selected !== null
          ? state.selected + 1
          : state.cuts.findIndex((cut) => cut > state.lineMs)
      return from >= 0 && from < state.cuts.length ? selectCut(state, from) : state
    }
  }
}

export function pieces(state: SplitState): { startMs: number; endMs: number }[] {
  const edges = [state.lowMs, ...state.cuts, state.highMs]
  return edges.slice(0, -1).map((startMs, i) => ({ startMs, endMs: edges[i + 1]! }))
}

export function canSave(state: SplitState): boolean {
  if (state.cuts.length === 0) return false
  return pieceProblem([state.lowMs, ...state.cuts, state.highMs], state.overLimit) === null
}

/** The index of the piece holding `ms`; a cut belongs to the piece it starts. */
export function pieceAt(state: SplitState, ms: number): number {
  return state.cuts.filter((cut) => cut <= ms).length
}

/** The loop color piece `index` is drawn in, so neighbors always differ. */
export function pieceColor(index: number): number {
  return LOOP_COLOR_ORDER[index % LOOP_COLOR_COUNT]!
}
