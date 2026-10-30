import type { CrosstuneDb } from '../db/schema'
import type { LocalRecording } from '../db/types'
import {
  MAX_RECORDING_MS,
  pieceLabel,
  pieceProblem,
  splitIncomplete,
  splitRangeEnd,
} from '../domain/recordingLimits'
import { RECORDING_NOT_FOUND, SPLIT_INVALID, SPLIT_OPEN } from './messages'
import { activeByPosition, newId, nextPosition, now, putRow, recordingTx, tombstone } from './write'

/**
 * Split a recording at `cutsMs`, positions on its source timeline. The parent keeps the first
 * piece and every later piece becomes a new row; returns the new piece ids in order.
 */
export async function splitRecording(
  db: CrosstuneDb,
  parentId: string,
  cutsMs: number[],
): Promise<string[]> {
  return recordingTx(db, async () => {
    const parent = await db.recordings.get(parentId)
    if (!parent || parent.deleted_at) throw new Error(RECORDING_NOT_FOUND)
    if (splitIncomplete(parent)) throw new Error(SPLIT_OPEN)

    const start = parent.trim_start_ms
    const end = splitRangeEnd(parent, await db.recording_files.get(parentId))
    if (end === null) throw new Error(SPLIT_INVALID)
    const cuts = [...cutsMs].sort((a, b) => a - b)
    if (cuts.length === 0 || cuts.some((cut) => cut <= start || cut >= end)) {
      throw new Error(SPLIT_INVALID)
    }
    const bounds = [start, ...cuts, end]
    if (pieceProblem(bounds, end - start > MAX_RECORDING_MS) !== null) {
      throw new Error(SPLIT_INVALID)
    }

    const at = now()
    const splitId = newId()
    const size = cuts.length + 1
    await putRow(db, 'recordings', {
      ...parent,
      updated_at: at,
      split_id: splitId,
      split_size: size,
      trim_end_ms: cuts[0]!,
    })

    const unfiled = activeByPosition(
      await db.recordings.filter((r) => r.tune_id === null).toArray(),
    )
    let position = nextPosition(unfiled)
    const ids: string[] = []
    for (let i = 1; i < size; i++) {
      const id = newId()
      ids.push(id)
      await putRow(
        db,
        'recordings',
        pieceRow(parent, id, splitId, i, bounds[i]!, bounds[i + 1]!, position++, at),
      )
    }

    const loops = (
      await db.recording_loops.where('recording_id').equals(parentId).toArray()
    ).filter((loop) => !loop.deleted_at)
    for (const loop of loops) {
      const index = bounds.findIndex(
        (b, i) => i < size && loop.start_ms >= b && loop.end_ms <= bounds[i + 1]!,
      )
      if (index === 0) continue
      await tombstone(db, 'recording_loops', loop.id, at)
      if (index < 0) continue
      await putRow(db, 'recording_loops', {
        ...loop,
        id: newId(),
        recording_id: ids[index - 1]!,
        created_at: at,
        updated_at: at,
        server_seq: 0,
      })
    }
    return ids
  })
}

function pieceRow(
  parent: LocalRecording,
  id: string,
  splitId: string,
  index: number,
  trimStart: number,
  trimEnd: number,
  position: number,
  at: string,
): LocalRecording {
  return {
    id,
    created_at: at,
    updated_at: at,
    deleted_at: null,
    server_seq: 0,
    tune_id: null,
    label: pieceLabel(parent.label ?? null, index + 1),
    source: parent.source,
    origin: parent.origin,
    origin_url: parent.origin_url,
    notes: parent.notes,
    players: parent.players,
    place_name: parent.place_name,
    place_id: parent.place_id,
    place_origin: parent.place_origin,
    place_lat: parent.place_lat,
    place_lon: parent.place_lon,
    place_accuracy_m: parent.place_accuracy_m,
    added_at: parent.added_at,
    recorded_at: parent.recorded_at,
    recorded_precision: parent.recorded_precision,
    split_from_id: parent.id,
    split_id: null,
    split_size: null,
    created_by_split_id: splitId,
    split_completed_id: null,
    position,
    state: 'processing',
    duration_ms: null,
    playback_mime: null,
    playback_bytes: null,
    error: null,
    trim_start_ms: trimStart,
    trim_end_ms: trimEnd,
    speed_percent: parent.speed_percent,
    pitch_cents: parent.pitch_cents,
    source_duration_ms: null,
    playback_start_ms: null,
    playback_end_ms: null,
    playback_rev: null,
    peaks_rev: null,
  }
}
