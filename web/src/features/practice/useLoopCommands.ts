import { addLoop, removeLoop } from '../../commands/loops'
import { LOOP_LIMIT, NO_ROOM, RECORDING_NOT_FOUND } from '../../commands/messages'
import { useDb } from '../../db/DbProvider'
import type { LocalRecordingLoop } from '../../db/types'
import {
  newLoop,
  placedLoop,
  spanFields,
  type Bounds,
  type NewLoop,
  type PlacedLoop,
} from '../../domain/loopModel'
import { LOOP_CREATED, LOOP_NOT_SAVED } from './practiceCopy'
import type { LoopPlayback } from './useLoopPlayback'

export interface LoopCommands {
  placed: PlacedLoop[]
  /** Where New loop would go now, or why it cannot. */
  result: NewLoop
  selected: LocalRecordingLoop | null
  /**
   * Makes the loop New loop offers at `atMs` (the playhead by default), selects it, and says so.
   * Returns where it went, or why it could not.
   */
  create: (atMs?: number) => NewLoop
  /** Deletes the selected loop. */
  remove: () => void
  /** Shows a refused loop write in the loop's own words. */
  report: (error: unknown) => void
}

/**
 * New loop and Delete loop, shared by the Loops mode's buttons and practice's keys. Times are on
 * the source timeline; `loops` is sorted by start.
 */
export function useLoopCommands({
  recordingId,
  loops,
  playback,
  playheadMs,
  bounds,
  announce,
  onCreated,
  onError,
}: {
  recordingId: string
  loops: readonly LocalRecordingLoop[]
  playback: LoopPlayback
  playheadMs: number
  bounds: Bounds
  announce: (text: string) => void
  onCreated?: (id: string) => void
  onError: (message: string) => void
}): LoopCommands {
  const db = useDb()
  const placed = loops.map(placedLoop)
  const result = newLoop(playheadMs, placed, bounds)
  const selected = loops.find((l) => l.id === playback.selectedId) ?? null

  const report = (error: unknown) => {
    // Practice goes with its recording, so a write refused for that reason needs no word.
    if (error instanceof Error && error.message === RECORDING_NOT_FOUND) return
    const message = error instanceof Error ? error.message : null
    onError(message === LOOP_LIMIT || message === NO_ROOM ? message : LOOP_NOT_SAVED)
  }

  const create = (atMs = playheadMs): NewLoop => {
    const made = atMs === playheadMs ? result : newLoop(atMs, placed, bounds)
    if (made.kind !== 'span') return made
    addLoop(db, recordingId, spanFields(made.span))
      .then((id) => {
        playback.select(id)
        announce(LOOP_CREATED)
        onCreated?.(id)
      })
      .catch(report)
    return made
  }

  const remove = () => {
    if (selected) removeLoop(db, selected.id).catch(report)
  }

  return { placed, result, selected, create, remove, report }
}
