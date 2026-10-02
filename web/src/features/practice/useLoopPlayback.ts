import { useCallback, useEffect, useState } from 'react'
import type { LocalRecordingLoop } from '../../db/types'
import { useEngineState, usePlaybackEngine } from '../player/PlaybackEngineProvider'
import type { RecordingView } from '../recordings/useRecordings'
import type { Span } from './loopModel'
import { loopHolds, loopRange } from './useLoopFollow'
import { rowSpan } from './loopModel'
import { useLatest } from '../../ui/useLatest'

export interface LoopPlayback {
  selectedId: string | null
  select: (id: string | null) => void
  repeat: boolean
  toggleRepeat: () => void
  /**
   * Plays `span` for loop `id` ahead of its row, as while a drag is under way or its write is
   * landing; the row takes over again once it holds the same span. Null lets go at once.
   */
  hold: (id: string, span: Span | null) => void
}

/**
 * The selected loop and Repeat, as Practice offers them. The engine holds the selection, so it
 * outlives Practice for as long as the recording stays loaded, and loading another recording
 * clears it. Following the selected loop's row is the dock's job (`useLoopFollow`), so it goes
 * on while Practice is closed; this hook only chooses, holds, and toggles.
 */
export function useLoopPlayback(
  view: RecordingView,
  loops: LocalRecordingLoop[] | undefined,
): LoopPlayback {
  const engine = usePlaybackEngine()
  const holds = loopHolds(engine)
  const loopId = useEngineState(engine, (s) => s.loop?.id ?? null)
  const repeat = useEngineState(engine, (s) => s.repeat)
  // A loop just created is selected before the live query has read its row.
  const [pending, setPending] = useState<string | null>(null)
  if (pending !== null && loopId === pending) setPending(null)
  const selectedId = pending ?? loopId

  const offsets = {
    blobStartMs: view.file?.blob_start_ms ?? 0,
    trimStartMs: view.recording.trim_start_ms,
  }
  const latestRef = useLatest({ loops, offsets })

  /** Selects `row`; a loop taking over Repeat from another starts from its top. */
  const take = useCallback(
    (row: LocalRecordingLoop) => {
      const { repeat, loop } = engine.getState()
      const { offsets } = latestRef.current
      engine.setLoop(loopRange(row, holds.get(), offsets))
      if (repeat && loop?.id !== row.id) engine.seek(row.start_ms - offsets.trimStartMs)
    },
    [engine, holds, latestRef],
  )

  useEffect(() => {
    if (!pending || !loops) return
    const row = loops.find((l) => l.id === pending)
    if (row) take(row)
  }, [loops, pending, take])

  const select = useCallback(
    (id: string | null) => {
      holds.drop()
      if (id === null) {
        setPending(null)
        engine.setLoop(null)
        engine.setRepeat(false)
        return
      }
      const row = latestRef.current.loops?.find((l) => l.id === id)
      if (!row) {
        setPending(id)
        return
      }
      setPending(null)
      take(row)
    },
    [engine, holds, take, latestRef],
  )

  const toggleRepeat = useCallback(() => {
    if (!engine.getState().loop) return
    engine.setRepeat(!engine.getState().repeat)
  }, [engine])

  const hold = useCallback(
    (id: string, span: Span | null) => {
      const row = latestRef.current.loops?.find((l) => l.id === id)
      const base = row ? rowSpan(row) : null
      holds.set(span ? { id, span, base } : null)
    },
    [holds, latestRef],
  )

  return { selectedId, select, repeat, toggleRepeat, hold }
}
