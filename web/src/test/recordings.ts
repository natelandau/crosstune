import { appendChunk, beginCapture, finishCapture, updateRecording } from '../commands/recordings'
import { newId } from '../commands/write'
import type { CrosstuneDb } from '../db/schema'
import { loopRow } from './rows'

const RECORDED_AT = '2026-09-14T20:00:00.000Z'

/**
 * A recording captured on this device, so its blob is already held locally. Any other fields
 * are written through `updateRecording`, so a file that spies on it should clear the spy after.
 */
export async function captureRecording(
  db: CrosstuneDb,
  {
    tuneId = null,
    durationMs = 30_000,
    ...patch
  }: { tuneId?: string | null; durationMs?: number } & Parameters<typeof updateRecording>[2] = {},
): Promise<string> {
  const id = newId()
  await beginCapture(db, id, { tuneId, recordedAt: RECORDED_AT })
  await appendChunk(db, id, 0, new Blob(['abc'], { type: 'audio/mp4' }))
  await finishCapture(db, id, {
    tuneId,
    mime: 'audio/mp4',
    durationMs,
    recordedAt: RECORDED_AT,
    peaks: null,
  })
  if (Object.keys(patch).length > 0) await updateRecording(db, id, patch)
  return id
}

/** A loop on a recording, written straight to the table so no command spy sees it. */
export async function seedLoop(
  db: CrosstuneDb,
  recordingId: string,
  startMs: number,
  endMs: number,
  extra: Parameters<typeof loopRow>[0] = {},
): Promise<string> {
  const id = newId()
  await db.recording_loops.put(
    loopRow({ id, recording_id: recordingId, start_ms: startMs, end_ms: endMs, ...extra }),
  )
  return id
}

/** A recording's loops that have not been deleted. */
export async function liveLoops(db: CrosstuneDb, recordingId: string) {
  return (await db.recording_loops.where('recording_id').equals(recordingId).toArray()).filter(
    (loop) => !loop.deleted_at,
  )
}
