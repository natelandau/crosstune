import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { addLoop, updateLoop } from '../../commands/loops'
import { LOOP_LIMIT, RECORDING_NOT_FOUND } from '../../commands/messages'
import { useDb } from '../../db/DbProvider'
import type { LocalRecordingLoop } from '../../db/types'
import { useEngineState, usePlaybackEngine } from '../player/PlaybackEngineProvider'
import { trimmedLengthMs } from '../recording-screen/recordingRange'
import type { RecordingView } from '../recordings/useRecordings'
import {
  canCreate,
  MIN_LOOP_MS,
  resizeSpan,
  rowSpan,
  type Span,
  spanFields,
  spanFromDrag,
} from './loopModel'
import { LOOP_NOT_SAVED } from './PracticeLanes'
import { LOOP_CREATED, LOOP_START_MARKED } from './PracticeTransport'
import type { LoopPlayback } from './useLoopPlayback'

/** A second tap on A B sooner than this after the first is taken for a slip and cancels. */
export const MARK_DOUBLE_TAP_MS = 500

export interface LoopMark {
  /** True from A B's first tap until its second, a seek, or Escape. */
  pending: boolean
  /** What the lane draws for the mark: start to playhead, then the new loop until its row lands. */
  band: Span | null
  create: { allowed: boolean; reason: string | null }
  /** A B: marks the start, or with a start marked, makes the loop. */
  tap: () => void
  /** `[`: the selected loop's start to the playhead, or with none selected, a new mark. */
  markStart: () => void
  /** `]`: the selected loop's end to the playhead, or with a mark pending, the loop. */
  markEnd: () => void
  /** Drops a pending mark; false when there was none. */
  cancel: () => boolean
}

type Phase =
  | { kind: 'marking'; startMs: number; at: number }
  | { kind: 'saving'; span: Span; id: string | null }
  | null

/**
 * A B and the `[` and `]` keys: a loop marked against the playhead as it plays, and the
 * selected loop's edges moved to it. Each finished mark or edge is one write.
 */
export function useLoopMark({
  view,
  loops,
  playback,
  announce,
  onError,
}: {
  view: RecordingView
  loops: LocalRecordingLoop[] | undefined
  playback: LoopPlayback
  announce: (message: string) => void
  onError: (message: string) => void
}): LoopMark {
  const { recording, file } = view
  const db = useDb()
  const engine = usePlaybackEngine()
  const trimStartMs = recording.trim_start_ms
  const loadedLengthMs = useEngineState(engine, (s) => s.lengthMs)
  const lengthMs = loadedLengthMs > 0 ? loadedLengthMs : (trimmedLengthMs(recording, file) ?? 0)
  const bounds = { startMs: trimStartMs, endMs: trimStartMs + lengthMs }
  const rows = loops ?? []
  const create = canCreate(rows.length, bounds)

  const [phase, setPhase] = useState<Phase>(null)
  if (phase?.kind === 'saving' && phase.id !== null && rows.some((l) => l.id === phase.id)) {
    setPhase(null)
  }

  const latest = useRef({ phase, bounds, create, rows, playback, announce, onError, recording })
  useLayoutEffect(() => {
    latest.current = { phase, bounds, create, rows, playback, announce, onError, recording }
  })

  const marking = phase?.kind === 'marking'
  // Only a loop being marked follows the playhead, so nothing else re-renders on every tick.
  const playheadMs = trimStartMs + useEngineState(engine, (s) => (marking ? s.positionMs : 0))
  useEffect(() => {
    if (!marking) return
    return engine.onJump(() => setPhase(null))
  }, [engine, marking])

  const here = useCallback(
    () => latest.current.recording.trim_start_ms + engine.getState().positionMs,
    [engine],
  )

  const report = useCallback((error: unknown) => {
    if (error instanceof Error && error.message === RECORDING_NOT_FOUND) return
    latest.current.onError(
      error instanceof Error && error.message === LOOP_LIMIT ? LOOP_LIMIT : LOOP_NOT_SAVED,
    )
  }, [])

  const begin = useCallback(() => {
    const { create, announce } = latest.current
    if (!create.allowed || engine.getState().lengthMs === 0) return
    setPhase({ kind: 'marking', startMs: here(), at: performance.now() })
    announce(LOOP_START_MARKED)
  }, [engine, here])

  const finish = useCallback(
    (startMs: number) => {
      const { bounds, playback, announce, recording } = latest.current
      const span = spanFromDrag(startMs, Math.max(here(), startMs + MIN_LOOP_MS), bounds)
      setPhase({ kind: 'saving', span, id: null })
      addLoop(db, recording.id, spanFields(span)).then(
        (id) => {
          setPhase((current) =>
            current?.kind === 'saving' && current.span === span ? { ...current, id } : current,
          )
          // Let go of any loop repeating now, so Repeat waits for this one rather than
          // jumping into the old one.
          playback.select(null)
          playback.select(id)
          engine.setRepeat(true)
          announce(LOOP_CREATED)
        },
        (error: unknown) => {
          setPhase((current) =>
            current?.kind === 'saving' && current.span === span ? null : current,
          )
          report(error)
        },
      )
    },
    [db, engine, here, report],
  )

  const tap = useCallback(() => {
    const { phase } = latest.current
    if (phase?.kind !== 'marking') {
      begin()
      return
    }
    if (performance.now() - phase.at < MARK_DOUBLE_TAP_MS) {
      setPhase(null)
      return
    }
    finish(phase.startMs)
  }, [begin, finish])

  const moveEdge = useCallback(
    (edge: 'start' | 'end') => {
      const { rows, playback, bounds } = latest.current
      const row = rows.find((l) => l.id === playback.selectedId)
      if (!row) return false
      const span = resizeSpan(rowSpan(row), edge, here(), bounds)
      const patch =
        edge === 'start'
          ? span.startMs === row.start_ms
            ? null
            : { start_ms: span.startMs }
          : span.endMs === row.end_ms
            ? null
            : { end_ms: span.endMs }
      if (patch) updateLoop(db, row.id, patch).catch(report)
      return true
    },
    [db, here, report],
  )

  const markStart = useCallback(() => {
    if (!moveEdge('start')) begin()
  }, [begin, moveEdge])

  const markEnd = useCallback(() => {
    const { phase } = latest.current
    if (phase?.kind === 'marking') finish(phase.startMs)
    else moveEdge('end')
  }, [finish, moveEdge])

  const cancel = useCallback(() => {
    if (latest.current.phase?.kind !== 'marking') return false
    setPhase(null)
    return true
  }, [])

  const band =
    phase?.kind === 'marking'
      ? { startMs: phase.startMs, endMs: Math.max(phase.startMs, playheadMs) }
      : (phase?.span ?? null)

  return { pending: marking, band, create, tap, markStart, markEnd, cancel }
}
