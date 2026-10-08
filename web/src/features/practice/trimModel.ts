import type { RecordingFile } from '../../db/recordings'
import type { LocalRecording } from '../../db/types'
import { trimmedLengthMs } from './recordingRange'
import { clamp } from '../../math'

/** The shortest kept range, as `MIN_TRIM_MS` in `api/src/crosstune/vocabulary.py` enforces. */
export const MIN_TRIM_MS = 1000

/** The shortest stretch the detail waveform zooms in to. */
export const MIN_DETAIL_MS = 2000

/** How much the detail waveform shows when the view opens. */
const OPENING_DETAIL_MS = 10_000

export type TrimHandle = 'start' | 'end'

/** Every value in ms on the source timeline. */
export interface TrimState {
  /** The row's current trim, which the handles cannot leave. */
  bounds: [number, number]
  start: number
  end: number
  /** The handle the detail waveform follows. */
  focus: TrimHandle
  /** How many times narrower than `bounds` the detail waveform is; 1 shows it all. */
  zoom: number
}

export type TrimAction =
  | { type: 'drag'; handle: TrimHandle; ms: number }
  | { type: 'nudge'; handle: TrimHandle; deltaMs: number }
  | { type: 'setAtPlayhead'; handle: TrimHandle; ms: number }
  | { type: 'focus'; handle: TrimHandle }
  | { type: 'zoom'; factor: number }
  | { type: 'restore'; start: number; end: number }

type TrimRow = Pick<LocalRecording, 'trim_start_ms' | 'trim_end_ms' | 'source_duration_ms'>

function maxZoom(state: Pick<TrimState, 'bounds'>): number {
  return Math.max(1, (state.bounds[1] - state.bounds[0]) / MIN_DETAIL_MS)
}

/** Handles on the row's current trim, the whole source when it has none. */
export function initialTrim(
  row: TrimRow,
  file: Pick<RecordingFile, 'local_duration_ms'> | undefined,
): TrimState {
  const start = row.trim_start_ms
  const end = start + (trimmedLengthMs(row, file) ?? 0)
  const bounds: [number, number] = [start, end]
  const zoom = clamp((end - start) / OPENING_DETAIL_MS, 1, maxZoom({ bounds }))
  return { bounds, start, end, focus: 'start', zoom }
}

/** `handle` moved as near `ms` as the bounds and the shortest kept range allow. */
function place(state: TrimState, handle: TrimHandle, ms: number): TrimState {
  const [low, high] = state.bounds
  if (handle === 'start') {
    const start = Math.round(clamp(ms, low, Math.max(low, state.end - MIN_TRIM_MS)))
    return { ...state, start, focus: 'start' }
  }
  const end = Math.round(clamp(ms, Math.min(high, state.start + MIN_TRIM_MS), high))
  return { ...state, end, focus: 'end' }
}

export function trimReducer(state: TrimState, action: TrimAction): TrimState {
  switch (action.type) {
    case 'drag':
      return place(state, action.handle, action.ms)
    case 'nudge':
      return place(state, action.handle, state[action.handle] + action.deltaMs)
    case 'setAtPlayhead': {
      // A playhead too near the other handle is a mistimed tap, so it moves nothing rather
      // than landing the handle somewhere the musician did not choose.
      const tooNear =
        action.handle === 'start'
          ? action.ms > state.end - MIN_TRIM_MS
          : action.ms < state.start + MIN_TRIM_MS
      return tooNear ? state : place(state, action.handle, action.ms)
    }
    case 'focus':
      return state.focus === action.handle ? state : { ...state, focus: action.handle }
    case 'zoom':
      return { ...state, zoom: clamp(state.zoom * action.factor, 1, maxZoom(state)) }
    case 'restore':
      return { ...state, start: action.start, end: action.end }
  }
}

/**
 * The stretch of the source the detail waveform shows: centered on `center` (the focused
 * handle by default), as wide as the zoom allows, and kept inside the bounds.
 */
export function detailWindow(state: TrimState, center = state[state.focus]): [number, number] {
  const [low, high] = state.bounds
  const length = clamp((high - low) / state.zoom, MIN_DETAIL_MS, high - low)
  const from = clamp(center - length / 2, low, high - length)
  return [from, from + length]
}

/** True once either handle has left the row's current trim. */
export function isChanged(state: TrimState, row: TrimRow): boolean {
  return state.start !== row.trim_start_ms || state.end !== (row.trim_end_ms ?? state.bounds[1])
}

/**
 * The trim to write. An end left on the source end stays null when the row had none, so the
 * row goes on meaning "to the end" rather than naming a length the server may measure
 * differently.
 */
export function trimPatch(
  state: TrimState,
  row: TrimRow,
): { trim_start_ms: number; trim_end_ms: number | null } {
  const keepsOpenEnd = row.trim_end_ms === null && state.end === state.bounds[1]
  return { trim_start_ms: state.start, trim_end_ms: keepsOpenEnd ? null : state.end }
}
