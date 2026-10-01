import type { CrosstuneDb } from '../db/schema'
import { MAX_LOOPS, pickColor } from '../features/practice/loopModel'
import { LOOP_LIMIT, RECORDING_NOT_FOUND } from './messages'
import { defined, newId, now, putRow, tombstone, writeTx } from './write'

export interface LoopSpan {
  start_ms: number
  end_ms: number
}

const cleanLabel = (label: string | null | undefined): string | null => label?.trim() || null

/** The recording's live loops, once it is known to be live with room for one more. */
async function roomForLoop(db: CrosstuneDb, recordingId: string) {
  const recording = await db.recordings.get(recordingId)
  if (!recording || recording.deleted_at) throw new Error(RECORDING_NOT_FOUND)
  const rows = await db.recording_loops.where('recording_id').equals(recordingId).toArray()
  const live = rows.filter((l) => !l.deleted_at)
  if (live.length >= MAX_LOOPS) throw new Error(LOOP_LIMIT)
  return live
}

export async function addLoop(
  db: CrosstuneDb,
  recordingId: string,
  span: LoopSpan,
  label?: string | null,
): Promise<string> {
  const at = now()
  const id = newId()
  await writeTx(db, async () => {
    const live = await roomForLoop(db, recordingId)
    const color = pickColor(
      { startMs: span.start_ms, endMs: span.end_ms },
      live.map((l) => ({ id: l.id, startMs: l.start_ms, endMs: l.end_ms, color: l.color })),
    )
    await putRow(db, 'recording_loops', {
      id,
      created_at: at,
      updated_at: at,
      deleted_at: null,
      server_seq: 0,
      recording_id: recordingId,
      label: cleanLabel(label),
      start_ms: span.start_ms,
      end_ms: span.end_ms,
      color,
    })
  })
  return id
}

export async function updateLoop(
  db: CrosstuneDb,
  id: string,
  patch: { start_ms?: number; end_ms?: number; label?: string | null },
): Promise<void> {
  await writeTx(db, async () => {
    const row = await db.recording_loops.get(id)
    // A sync tombstone can land mid-gesture; the loop is gone, so there is nothing to save.
    if (!row || row.deleted_at) return
    const next = defined({
      start_ms: patch.start_ms,
      end_ms: patch.end_ms,
      label: patch.label === undefined ? undefined : cleanLabel(patch.label),
    })
    await putRow(db, 'recording_loops', { ...row, ...next, updated_at: now() })
  })
}

export async function removeLoop(db: CrosstuneDb, id: string): Promise<void> {
  await writeTx(db, () => tombstone(db, 'recording_loops', id, now()))
}

/** Undo a removal: the stored row goes back live with its original span, if its recording is
 * still live and has room for it. */
export async function restoreLoop(db: CrosstuneDb, id: string): Promise<void> {
  await writeTx(db, async () => {
    const row = await db.recording_loops.get(id)
    // Nothing to restore when the row is already live, as after a second undo.
    if (!row?.deleted_at) return
    await roomForLoop(db, row.recording_id)
    await putRow(db, 'recording_loops', { ...row, deleted_at: null, updated_at: now() })
  })
}
