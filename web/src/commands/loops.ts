import type { CrosstuneDb } from '../db/schema'
import {
  freeGap,
  MAX_LOOPS,
  MIN_LOOP_MS,
  pickColor,
  roomAround,
  rowSpan,
  type Bounds,
  type PlacedLoop,
} from '../features/practice/loopModel'
import { LOOP_LIMIT, NO_ROOM, RECORDING_NOT_FOUND } from './messages'
import { defined, newId, now, putRow, tombstone, writeTx } from './write'

export interface LoopSpan {
  start_ms: number
  end_ms: number
}

const cleanLabel = (label: string | null | undefined): string | null => label?.trim() || null

/** The recording's live loops, sorted by start, and its trimmed range on the source timeline. */
async function loopsAndBounds(db: CrosstuneDb, recordingId: string) {
  const recording = await db.recordings.get(recordingId)
  if (!recording || recording.deleted_at) throw new Error(RECORDING_NOT_FOUND)
  const rows = await db.recording_loops.where('recording_id').equals(recordingId).toArray()
  const live: PlacedLoop[] = rows
    .filter((l) => !l.deleted_at)
    .map((l) => ({ id: l.id, startMs: l.start_ms, endMs: l.end_ms, color: l.color }))
    .sort((a, b) => a.startMs - b.startMs)
  const bounds: Bounds = {
    startMs: recording.trim_start_ms,
    endMs: recording.trim_end_ms ?? recording.source_duration_ms ?? Infinity,
  }
  return { live, bounds }
}

/** `span` held inside `room`, or NO_ROOM when less than a minimum loop is left. */
function within(span: LoopSpan, room: Bounds): LoopSpan {
  const start_ms = Math.max(span.start_ms, room.startMs)
  const end_ms = Math.min(span.end_ms, room.endMs)
  if (end_ms - start_ms < MIN_LOOP_MS) throw new Error(NO_ROOM)
  return { start_ms, end_ms }
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
    const { live, bounds } = await loopsAndBounds(db, recordingId)
    if (live.length >= MAX_LOOPS) throw new Error(LOOP_LIMIT)
    const gap = freeGap(span.start_ms, live, bounds)
    if (!gap) throw new Error(NO_ROOM)
    const placed = within(span, gap)
    const color = pickColor(rowSpan(placed), live)
    await putRow(db, 'recording_loops', {
      id,
      created_at: at,
      updated_at: at,
      deleted_at: null,
      server_seq: 0,
      recording_id: recordingId,
      label: cleanLabel(label),
      start_ms: placed.start_ms,
      end_ms: placed.end_ms,
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
    let { start_ms, end_ms } = patch
    if (start_ms !== undefined || end_ms !== undefined) {
      const { live, bounds } = await loopsAndBounds(db, row.recording_id)
      const others = live.filter((l) => l.id !== id)
      const room = roomAround(rowSpan(row), others, bounds)
      ;({ start_ms, end_ms } = within(
        { start_ms: start_ms ?? row.start_ms, end_ms: end_ms ?? row.end_ms },
        room,
      ))
    }
    const next = defined({
      start_ms,
      end_ms,
      label: patch.label === undefined ? undefined : cleanLabel(patch.label),
    })
    await putRow(db, 'recording_loops', { ...row, ...next, updated_at: now() })
  })
}

export async function removeLoop(db: CrosstuneDb, id: string): Promise<void> {
  await writeTx(db, () => tombstone(db, 'recording_loops', id, now()))
}
