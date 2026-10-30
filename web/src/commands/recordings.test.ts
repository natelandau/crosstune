import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RECORDING_LIMITS } from '../api/vocabulary'
import { pendingFor } from '../db/outbox'
import { getKeepOffline, setKeepOffline } from '../db/meta'
import type { CrosstuneDb } from '../db/schema'
import { openTestDb } from '../test/db'
import { loopRow } from '../test/rows'
import {
  LINK_NOT_FOUND,
  RECORDED_DATE_FUTURE,
  RECORDED_DATE_INVALID,
  RECORDED_DATE_MISMATCH,
  RECORDED_DATE_OFF_PERIOD,
  RECORDING_HELD,
  TUNE_NOT_FOUND,
} from './messages'
import {
  addRecordingFromLink,
  addUploadedFile,
  appendChunk,
  beginCapture,
  cancelCapture,
  clearDownloadedBlobs,
  deleteRecording,
  fillCapturedPlace,
  finishCapture,
  localAudioBytes,
  retryUpload,
  setFileState,
  storeDownloadedBlob,
  defaultRecordingLabel,
  updateRecording,
} from './recordings'
import { deleteTunes } from './bulk'
import { addLink, removeLink } from './links'
import { splitRecording } from './split'
import { createTune, deleteTune } from './tunes'
import { newId } from './write'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

const AT = '2026-09-14T20:00:00.000Z'

async function captured(tuneId: string | null = null): Promise<string> {
  const id = newId()
  await beginCapture(db, id, { tuneId: null, recordedAt: new Date().toISOString() })
  await appendChunk(db, id, 0, new Blob(['ab'], { type: 'audio/mp4' }))
  await appendChunk(db, id, 1, new Blob(['cd'], { type: 'audio/mp4' }))
  await finishCapture(db, id, {
    tuneId,
    mime: 'audio/mp4',
    durationMs: 10_000,
    recordedAt: AT,
    peaks: null,
  })
  return id
}

describe('defaultRecordingLabel', () => {
  it('names a recording for its local start time to the minute', () => {
    const at = new Date(2026, 8, 14, 9, 5, 59)
    expect(defaultRecordingLabel(at)).toBe('2026-09-14 09:05')
    expect(defaultRecordingLabel(at.toISOString())).toBe('2026-09-14 09:05')
  })
})

describe('capture', () => {
  it('assembles chunks into one blob and queues the synced row', async () => {
    const id = await captured()
    const file = await db.recording_files.get(id)
    expect(file).toMatchObject({
      local_state: 'captured',
      bytes: 4,
      mime: 'audio/mp4',
    })
    expect(await file?.blob?.text()).toBe('abcd')
    expect(await db.recording_chunks.where('recording_id').equals(id).count()).toBe(0)
    const row = await db.recordings.get(id)
    expect(row).toMatchObject({
      tune_id: null,
      source: 'microphone',
      added_at: AT,
      recorded_at: AT,
      recorded_precision: 'time',
      state: 'pending_upload',
    })
    const queued = await pendingFor(db, 'recordings', id)
    expect(queued?.data).toMatchObject({
      source: 'microphone',
      added_at: AT,
      recorded_at: AT,
      recorded_precision: 'time',
      position: 0,
    })
    expect(queued?.data).not.toHaveProperty('state')
  })

  it('a new capture has no notes, players, or place', async () => {
    const id = await captured()
    const none = {
      notes: null,
      players: null,
      place_name: null,
      place_lat: null,
      place_lon: null,
      place_accuracy_m: null,
      place_id: null,
      place_origin: null,
    }
    expect(await db.recordings.get(id)).toMatchObject(none)
    expect((await pendingFor(db, 'recordings', id))?.data).toMatchObject(none)
  })

  it.each([
    [
      'with its accuracy',
      { lat: 36.661234, lon: -80.923912, accuracyM: 12 },
      { place_lat: 36.661234, place_lon: -80.923912, place_accuracy_m: 12, place_origin: 'device' },
    ],
    [
      'with no accuracy',
      { lat: 36.661234, lon: -80.923912, accuracyM: null },
      {
        place_lat: 36.661234,
        place_lon: -80.923912,
        place_accuracy_m: null,
        place_origin: 'device',
      },
    ],
    [
      'none',
      null,
      { place_lat: null, place_lon: null, place_accuracy_m: null, place_origin: null },
    ],
  ])(
    'stores and queues the place a capture began at, %s, without a name',
    async (_, place, stored) => {
      const id = newId()
      await beginCapture(db, id, { tuneId: null, recordedAt: AT })
      await appendChunk(db, id, 0, new Blob(['ab'], { type: 'audio/mp4' }))
      await finishCapture(db, id, {
        tuneId: null,
        mime: 'audio/mp4',
        durationMs: 10_000,
        recordedAt: AT,
        peaks: null,
        place,
      })
      const expected = { place_name: null, ...stored }
      expect(await db.recordings.get(id)).toMatchObject(expected)
      expect((await pendingFor(db, 'recordings', id))?.data).toMatchObject(expected)
    },
  )

  /** The stamp the recording's save left on its row. */
  const savedAt = async (id: string) => (await db.recordings.get(id))!.updated_at

  it('returns the stamp the finished take was saved with', async () => {
    const id = newId()
    await beginCapture(db, id, { tuneId: null, recordedAt: AT })
    await appendChunk(db, id, 0, new Blob(['ab'], { type: 'audio/mp4' }))
    const fields = {
      tuneId: null,
      mime: 'audio/mp4',
      durationMs: 10_000,
      recordedAt: AT,
      peaks: null,
    }
    const stamp = await finishCapture(db, id, fields)
    expect(stamp).toBe(await savedAt(id))
    expect(await finishCapture(db, id, fields)).toBeNull()
  })

  it('fills a saved recording with no place from a late fix and queues it', async () => {
    const id = await captured()
    await fillCapturedPlace(
      db,
      id,
      { lat: 36.661234, lon: -80.923912, accuracyM: 12 },
      await savedAt(id),
    )
    const expected = {
      place_name: null,
      place_lat: 36.661234,
      place_lon: -80.923912,
      place_accuracy_m: 12,
      place_id: null,
      place_origin: 'device',
    }
    expect(await db.recordings.get(id)).toMatchObject(expected)
    expect((await pendingFor(db, 'recordings', id))?.data).toMatchObject(expected)
  })

  it('puts a failed upload back in the queue when a late fix fills the recording', async () => {
    const id = await captured()
    await setFileState(db, id, 'failed_upload', 'bad type')
    await fillCapturedPlace(db, id, { lat: 36.66, lon: -80.92, accuracyM: 12 }, await savedAt(id))
    expect(await db.recording_files.get(id)).toMatchObject({ local_state: 'captured', error: null })
  })

  it.each([
    ['coordinates', { place_lat: 1, place_lon: 2, place_accuracy_m: 3 }],
    ['a name', { place_name: 'Galax, VA' }],
  ])('never fills a recording that already has %s', async (_, place) => {
    const id = await captured()
    await db.recordings.update(id, place)
    const before = await db.recordings.get(id)
    await fillCapturedPlace(db, id, { lat: 36.66, lon: -80.92, accuracyM: 12 }, before!.updated_at)
    expect(await db.recordings.get(id)).toEqual(before)
  })

  it.each([
    ['cleared its place', { place_name: null, place_lat: null, place_lon: null }],
    ['renamed it', { label: 'Jam' }],
  ])('never fills a recording once the musician %s after the save', async (_, patch) => {
    const id = await captured()
    const stamp = await savedAt(id)
    await updateRecording(db, id, patch)
    const before = await db.recordings.get(id)
    await fillCapturedPlace(db, id, { lat: 36.66, lon: -80.92, accuracyM: 12 }, stamp)
    expect(await db.recordings.get(id)).toEqual(before)
    expect(before).toMatchObject({ place_lat: null, place_lon: null })
  })

  it('never fills a deleted or missing take', async () => {
    const id = await captured()
    await deleteRecording(db, id)
    const before = await db.recordings.get(id)
    const fix = { lat: 36.66, lon: -80.92, accuracyM: 12 }
    await fillCapturedPlace(db, id, fix, before!.updated_at)
    await fillCapturedPlace(db, 'missing', fix, before!.updated_at)
    expect(await db.recordings.get(id)).toEqual(before)
    expect(await db.recordings.get('missing')).toBeUndefined()
  })

  it('a new capture defaults trim, speed, and pitch', async () => {
    const id = await captured()
    expect(await db.recordings.get(id)).toMatchObject({
      trim_start_ms: 0,
      trim_end_ms: null,
      speed_percent: 100,
      pitch_cents: 0,
      source_duration_ms: null,
      playback_start_ms: null,
      playback_end_ms: null,
      playback_rev: null,
      peaks_rev: null,
    })
  })

  it('cancel drops the chunks and the file row', async () => {
    const id = newId()
    await beginCapture(db, id, { tuneId: null, recordedAt: new Date().toISOString() })
    await appendChunk(db, id, 0, new Blob(['x']))
    await cancelCapture(db, id)
    expect(await db.recording_files.get(id)).toBeUndefined()
    expect(await db.recording_chunks.count()).toBe(0)
    expect(await db.recordings.get(id)).toBeUndefined()
  })

  it('attaches to a tune and positions after existing recordings', async () => {
    const { tuneId } = await createTune(db, { title: 'X' }, { status: 'known' })
    await captured(tuneId)
    const second = await captured(tuneId)
    expect((await db.recordings.get(second))?.position).toBe(1)
  })

  it('ignores a repeated finish for an already finished capture', async () => {
    const id = await captured()
    const position = (await db.recordings.get(id))?.position
    await finishCapture(db, id, {
      tuneId: null,
      mime: 'audio/mp4',
      durationMs: 5_000,
      recordedAt: AT,
      peaks: null,
    })
    const file = await db.recording_files.get(id)
    expect(await file?.blob?.text()).toBe('abcd')
    expect(file?.bytes).toBe(4)
    expect((await db.recordings.get(id))?.position).toBe(position)
  })

  it('leaves a finished recording alone when cancelCapture races it', async () => {
    const id = await captured()
    const file = await db.recording_files.get(id)
    const row = await db.recordings.get(id)
    await cancelCapture(db, id)
    expect(await db.recording_files.get(id)).toEqual(file)
    expect(await db.recordings.get(id)).toEqual(row)
  })

  it('ignores a finish after cancelCapture', async () => {
    const id = newId()
    await beginCapture(db, id, { tuneId: null, recordedAt: new Date().toISOString() })
    await appendChunk(db, id, 0, new Blob(['x']))
    await cancelCapture(db, id)
    await finishCapture(db, id, {
      tuneId: null,
      mime: 'audio/mp4',
      durationMs: 1000,
      recordedAt: AT,
      peaks: null,
    })
    expect(await db.recordings.get(id)).toBeUndefined()
    expect(await db.recording_files.get(id)).toBeUndefined()
  })

  it('writes nothing for a chunk with no file row', async () => {
    await appendChunk(db, 'ghost', 0, new Blob(['x']))
    expect(await db.recording_chunks.where('recording_id').equals('ghost').count()).toBe(0)
  })

  it('writes nothing for a chunk that arrives once the capture has finished', async () => {
    const id = await captured()
    await appendChunk(db, id, 5, new Blob(['x'], { type: 'audio/mp4' }))
    expect(await db.recording_chunks.where('recording_id').equals(id).count()).toBe(0)
    expect((await db.recording_files.get(id))?.last_chunk_at).toBeNull()
  })
})

describe('uploads and edits', () => {
  it('saves notes, players, and place on the row and in the queued change', async () => {
    const id = await captured()
    await updateRecording(db, id, {
      notes: 'Played slow',
      players: 'Ann, Bob',
      place_name: 'Galax, VA',
      place_lat: 36.66,
      place_lon: -80.92,
    })
    const expected = {
      notes: 'Played slow',
      players: 'Ann, Bob',
      place_name: 'Galax, VA',
      place_lat: 36.66,
      place_lon: -80.92,
      place_accuracy_m: null,
    }
    expect(await db.recordings.get(id)).toMatchObject(expected)
    expect((await pendingFor(db, 'recordings', id))?.data).toMatchObject(expected)
  })

  it('a place edit marks the place picked and unlinks it, and clearing it clears the origin', async () => {
    const id = await captured()
    await db.recordings.update(id, {
      place_id: 'p1',
      place_origin: 'device',
      place_lat: 1,
      place_lon: 2,
    })
    await updateRecording(db, id, {
      place_name: 'Galax, VA',
      place_lat: 36.66,
      place_lon: -80.92,
      place_accuracy_m: null,
    })
    const picked = { place_id: null, place_origin: 'picked', place_lat: 36.66 }
    expect(await db.recordings.get(id)).toMatchObject(picked)
    expect((await pendingFor(db, 'recordings', id))?.data).toMatchObject(picked)

    await updateRecording(db, id, {
      place_name: null,
      place_lat: null,
      place_lon: null,
      place_accuracy_m: null,
    })
    const cleared = { place_id: null, place_origin: null, place_lat: null }
    expect(await db.recordings.get(id)).toMatchObject(cleared)
    expect((await pendingFor(db, 'recordings', id))?.data).toMatchObject(cleared)
  })

  it('a hand place edit clears the accuracy, as a pick has none', async () => {
    const id = await captured()
    await db.recordings.update(id, { place_lat: 1, place_lon: 2, place_accuracy_m: 12 })
    await updateRecording(db, id, {
      place_name: 'Galax, VA',
      place_lat: 36.66,
      place_lon: -80.92,
      place_accuracy_m: 40,
    })
    expect((await db.recordings.get(id))?.place_accuracy_m).toBeNull()
    expect((await pendingFor(db, 'recordings', id))?.data).toMatchObject({ place_accuracy_m: null })
  })

  it('an edit that leaves the place alone keeps its link and origin', async () => {
    const id = await captured()
    await db.recordings.update(id, {
      place_id: 'p1',
      place_origin: 'device',
      place_lat: 1,
      place_lon: 2,
    })
    await updateRecording(db, id, { label: 'Jam' })
    expect(await db.recordings.get(id)).toMatchObject({ place_id: 'p1', place_origin: 'device' })
  })

  it('stores an uploaded file as captured with its type', async () => {
    const file = new File(['wav-bytes'], 'jam.wav', { type: 'audio/wav' })
    const id = await addUploadedFile(db, file, {
      tuneId: null,
      label: 'Field recorder',
      durationMs: 187_457,
    })
    expect(await db.recording_files.get(id)).toMatchObject({
      local_state: 'captured',
      mime: 'audio/wav',
      bytes: 9,
      local_duration_ms: 187_457,
    })
    expect(await db.recordings.get(id)).toMatchObject({ source: 'upload', label: 'Field recorder' })
  })

  it('dates an upload by when it was added and leaves when it was played unknown', async () => {
    const file = new File(['wav-bytes'], 'jam.wav', { type: 'audio/wav', lastModified: 0 })
    const id = await addUploadedFile(db, file, { tuneId: null, label: null, durationMs: null })
    const row = await db.recordings.get(id)
    expect(row?.added_at).toBe(row?.created_at)
    expect(row).toMatchObject({ recorded_at: null, recorded_precision: null })
    expect((await pendingFor(db, 'recordings', id))?.data).toMatchObject({
      added_at: row?.created_at,
      recorded_at: null,
      recorded_precision: null,
    })
  })

  it('stores an uploaded file with no measured length as unknown', async () => {
    const file = new File(['webm-bytes'], 'jam.webm', { type: 'audio/webm' })
    const id = await addUploadedFile(db, file, { tuneId: null, label: null, durationMs: null })
    expect((await db.recording_files.get(id))?.local_duration_ms).toBeNull()
  })

  it('updates label and tune and queues the row', async () => {
    const { tuneId } = await createTune(db, { title: 'X' }, { status: 'known' })
    const id = await captured()
    await updateRecording(db, id, { label: 'Recording 2', tune_id: tuneId })
    expect(await db.recordings.get(id)).toMatchObject({ label: 'Recording 2', tune_id: tuneId })
    expect((await pendingFor(db, 'recordings', id))?.data).toMatchObject({
      label: 'Recording 2',
      tune_id: tuneId,
    })
  })

  it('updateRecording writes a partial recorded date and queues it', async () => {
    const id = await captured()
    const date = { recorded_at: '1937-01-01T00:00:00.000Z', recorded_precision: 'year' } as const
    await updateRecording(db, id, date)
    expect(await db.recordings.get(id)).toMatchObject({ ...date, added_at: AT })
    expect((await pendingFor(db, 'recordings', id))?.data).toMatchObject({ ...date, added_at: AT })
  })

  it('updateRecording clears the recorded date and keeps when it was added', async () => {
    const id = await captured()
    await updateRecording(db, id, { recorded_at: null, recorded_precision: null })
    expect(await db.recordings.get(id)).toMatchObject({
      added_at: AT,
      recorded_at: null,
      recorded_precision: null,
    })
  })

  it('updateRecording refuses a recorded date without its precision or the reverse', async () => {
    const id = await captured()
    const before = await db.recordings.get(id)
    for (const patch of [
      { recorded_at: '1937-01-01T00:00:00.000Z' },
      { recorded_precision: 'year' },
      { recorded_at: null, recorded_precision: 'year' },
      { recorded_at: '1937-01-01T00:00:00.000Z', recorded_precision: null },
    ] as const) {
      await expect(updateRecording(db, id, patch)).rejects.toThrow(RECORDED_DATE_MISMATCH)
    }
    expect(await db.recordings.get(id)).toEqual(before)
  })

  it('updateRecording refuses a partial date off the start of its period', async () => {
    const id = await captured()
    for (const patch of [
      { recorded_at: '1937-05-01T00:00:00.000Z', recorded_precision: 'year' },
      { recorded_at: '1998-05-02T00:00:00.000Z', recorded_precision: 'month' },
      { recorded_at: '1998-10-03T04:00:00.000Z', recorded_precision: 'day' },
    ] as const) {
      await expect(updateRecording(db, id, patch)).rejects.toThrow(RECORDED_DATE_OFF_PERIOD)
    }
    expect((await db.recordings.get(id))?.recorded_at).toBe(AT)
  })

  it('updateRecording refuses a partial recorded date more than a day ahead', async () => {
    const id = await captured()
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-04T12:00:00.000Z') })
    try {
      for (const patch of [
        { recorded_at: '2026-10-06T00:00:00.000Z', recorded_precision: 'day' },
        { recorded_at: '2999-01-01T00:00:00.000Z', recorded_precision: 'year' },
      ] as const) {
        await expect(updateRecording(db, id, patch)).rejects.toThrow(RECORDED_DATE_FUTURE)
      }
      expect((await db.recordings.get(id))?.recorded_at).toBe(AT)
    } finally {
      vi.useRealTimers()
    }
  })

  it('updateRecording accepts a captured time more than a day ahead', async () => {
    const id = await captured()
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-04T12:00:00.000Z') })
    try {
      const fast = '2026-10-06T12:00:00.000Z'
      await updateRecording(db, id, { recorded_at: fast, recorded_precision: 'time' })
      expect((await db.recordings.get(id))?.recorded_at).toBe(fast)
    } finally {
      vi.useRealTimers()
    }
  })

  it('updateRecording accepts a recorded date exactly a day ahead', async () => {
    const id = await captured()
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-04T12:00:00.000Z') })
    try {
      const edge = '2026-10-05T00:00:00.000Z'
      await updateRecording(db, id, { recorded_at: edge, recorded_precision: 'day' })
      expect((await db.recordings.get(id))?.recorded_at).toBe(edge)
      await expect(
        updateRecording(db, id, {
          recorded_at: '2026-10-06T00:00:00.000Z',
          recorded_precision: 'day',
        }),
      ).rejects.toThrow(RECORDED_DATE_FUTURE)
    } finally {
      vi.useRealTimers()
    }
  })

  it('updateRecording refuses a recorded date that is not a date', async () => {
    const id = await captured()
    for (const precision of ['time', 'year', 'month', 'day'] as const) {
      await expect(
        updateRecording(db, id, { recorded_at: 'garbage', recorded_precision: precision }),
      ).rejects.toThrow(RECORDED_DATE_INVALID)
    }
    expect((await db.recordings.get(id))?.recorded_at).toBe(AT)
  })

  it('updateRecording writes speed and pitch and queues one upsert', async () => {
    const id = await captured()
    await updateRecording(db, id, { speed_percent: 75, pitch_cents: 200 })
    expect(await db.recordings.get(id)).toMatchObject({ speed_percent: 75, pitch_cents: 200 })
    const queued = await pendingFor(db, 'recordings', id)
    expect(queued?.data).toMatchObject({ speed_percent: 75, pitch_cents: 200 })
    expect(queued?.data).not.toHaveProperty('source_duration_ms')
    expect(queued?.data).not.toHaveProperty('playback_start_ms')
    expect(queued?.data).not.toHaveProperty('playback_end_ms')
    expect(queued?.data).not.toHaveProperty('playback_rev')
    expect(queued?.data).not.toHaveProperty('peaks_rev')
  })

  it('puts a failed upload back in the queue when the recording is edited', async () => {
    const id = await captured()
    await setFileState(db, id, 'failed_upload', 'bad type')
    await updateRecording(db, id, { label: 'Recording 3' })
    expect(await db.recording_files.get(id)).toMatchObject({ local_state: 'captured', error: null })
  })

  it('retries a failed upload and leaves any other state alone', async () => {
    const failed = await captured()
    const uploaded = await captured()
    await setFileState(db, failed, 'failed_upload', 'bad type')
    await setFileState(db, uploaded, 'uploaded')
    await retryUpload(db, failed)
    await retryUpload(db, uploaded)
    expect(await db.recording_files.get(failed)).toMatchObject({
      local_state: 'captured',
      error: null,
    })
    expect((await db.recording_files.get(uploaded))?.local_state).toBe('uploaded')
  })

  it('puts a backed-off upload at the front of the queue again', async () => {
    const id = await captured()
    await db.recording_files.update(id, {
      error: 'Network request failed',
      upload_attempts: 3,
      next_attempt_at: Date.now() + 60_000,
    })
    await retryUpload(db, id)
    expect(await db.recording_files.get(id)).toMatchObject({
      local_state: 'captured',
      error: null,
      upload_attempts: 0,
      next_attempt_at: null,
    })
  })

  it('rejects moving a recording to a deleted tune and leaves the row unchanged', async () => {
    const { tuneId } = await createTune(db, { title: 'X' }, { status: 'known' })
    await deleteTune(db, tuneId)
    const id = await captured()
    const before = await db.recordings.get(id)
    await expect(updateRecording(db, id, { tune_id: tuneId })).rejects.toThrow(TUNE_NOT_FOUND)
    expect(await db.recordings.get(id)).toEqual(before)
  })

  it('deletes with a tombstone and drops the local file', async () => {
    const id = await captured()
    await deleteRecording(db, id)
    expect((await db.recordings.get(id))?.deleted_at).not.toBeNull()
    expect((await pendingFor(db, 'recordings', id))?.op).toBe('delete')
    expect(await db.recording_files.get(id)).toBeUndefined()
  })

  it('deleting a recording tombstones its loops without enqueueing their deletes', async () => {
    const id = await captured()
    await db.recording_loops.put(loopRow({ id: 'lp', recording_id: id }))
    await deleteRecording(db, id)
    expect((await db.recording_loops.get('lp'))?.deleted_at).not.toBeNull()
    expect(await pendingFor(db, 'recording_loops', 'lp')).toBeUndefined()
  })

  it('deleting a tune tombstones its recordings loops without enqueueing their deletes', async () => {
    const { tuneId } = await createTune(db, { title: 'X' }, { status: 'known' })
    const id = await captured(tuneId)
    await db.recording_loops.put(loopRow({ id: 'lp', recording_id: id }))
    await deleteTune(db, tuneId)
    expect((await db.recording_loops.get('lp'))?.deleted_at).not.toBeNull()
    expect(await pendingFor(db, 'recording_loops', 'lp')).toBeUndefined()
  })

  it('deleting a tune keeps a split parent whose piece waits for its cut, unfiled', async () => {
    const { tuneId } = await createTune(db, { title: 'X' }, { status: 'known' })
    const id = await captured(tuneId)
    const [pieceId] = await splitRecording(db, id, [5_000])
    await deleteTune(db, tuneId)
    const parent = await db.recordings.get(id)
    expect(parent?.deleted_at).toBeNull()
    expect(parent?.tune_id).toBeNull()
    expect((await db.recording_files.get(id))?.blob).toBeTruthy()
    expect((await db.recordings.get(pieceId!))?.deleted_at).toBeNull()
    expect((await pendingFor(db, 'recordings', id))?.op).toBe('upsert')
  })

  it('deleting a tune deletes a split parent whose waiting piece is filed under it', async () => {
    const { tuneId } = await createTune(db, { title: 'X' }, { status: 'known' })
    const id = await captured(tuneId)
    const [pieceId] = await splitRecording(db, id, [5_000])
    await db.recordings.update(pieceId!, { tune_id: tuneId })
    await deleteTune(db, tuneId)
    expect((await db.recordings.get(id))?.deleted_at).not.toBeNull()
    expect((await db.recordings.get(pieceId!))?.deleted_at).not.toBeNull()
  })

  it('deleting tunes together deletes a split parent whose waiting piece is in another', async () => {
    for (const parentFirst of [true, false]) {
      const a = await createTune(db, { title: 'A' }, { status: 'known' })
      const b = await createTune(db, { title: 'B' }, { status: 'known' })
      const id = await captured(a.tuneId)
      const [pieceId] = await splitRecording(db, id, [5_000])
      await db.recordings.update(pieceId!, { tune_id: b.tuneId })
      const ids = [a.userTuneId, b.userTuneId]
      await deleteTunes(db, parentFirst ? ids : ids.reverse())
      expect((await db.recordings.get(id))?.deleted_at).not.toBeNull()
      expect((await db.recordings.get(pieceId!))?.deleted_at).not.toBeNull()
    }
  })

  it("deleting a tune leaves a held split parent's loops as they are", async () => {
    const { tuneId } = await createTune(db, { title: 'X' }, { status: 'known' })
    const id = await captured(tuneId)
    await splitRecording(db, id, [5_000])
    await db.recording_loops.put(loopRow({ id: 'lp', recording_id: id }))
    const before = await db.recording_loops.get('lp')
    await deleteTune(db, tuneId)
    expect(await db.recording_loops.get('lp')).toEqual(before)
    expect(await pendingFor(db, 'recording_loops', 'lp')).toBeUndefined()
  })

  it('refuses to delete a split parent while a piece waits for its cut', async () => {
    const id = await captured()
    await splitRecording(db, id, [5_000])
    await expect(deleteRecording(db, id)).rejects.toThrow(RECORDING_HELD)
    expect((await db.recordings.get(id))?.deleted_at).toBeNull()
    expect(await db.recording_files.get(id)).toBeDefined()
  })

  it('deleting a tune deletes a split parent whose pieces are all cut', async () => {
    const { tuneId } = await createTune(db, { title: 'X' }, { status: 'known' })
    const id = await captured(tuneId)
    const [pieceId] = await splitRecording(db, id, [5_000])
    await db.recordings.update(pieceId!, { state: 'ready' })
    await deleteTune(db, tuneId)
    expect((await db.recordings.get(id))?.deleted_at).not.toBeNull()
    expect(await db.recording_files.get(id)).toBeUndefined()
  })

  it('deleting a tune deletes a failed split parent', async () => {
    const { tuneId } = await createTune(db, { title: 'X' }, { status: 'known' })
    const id = await captured(tuneId)
    await splitRecording(db, id, [5_000])
    await db.recordings.update(id, { state: 'failed' })
    await deleteTune(db, tuneId)
    expect((await db.recordings.get(id))?.deleted_at).not.toBeNull()
  })

  it('deleting a tune tombstones its recordings without a second delete change', async () => {
    const { tuneId } = await createTune(db, { title: 'X' }, { status: 'known' })
    const id = await captured(tuneId)
    await deleteTune(db, tuneId)
    expect((await db.recordings.get(id))?.deleted_at).not.toBeNull()
    expect(await pendingFor(db, 'recordings', id)).toBeUndefined()
    expect(await db.recording_files.get(id)).toBeUndefined()
  })
})

describe('keep offline and local audio', () => {
  it('keep offline is one setting for the whole device, off until turned on', async () => {
    expect(await getKeepOffline(db)).toBe(false)
    await setKeepOffline(db, true)
    expect(await getKeepOffline(db)).toBe(true)
    await setKeepOffline(db, false)
    expect(await getKeepOffline(db)).toBe(false)
  })

  it('stores a downloaded blob and clears the ones the server can serve back', async () => {
    const kept = await captured()
    const dropped = await captured()
    await setFileState(db, dropped, 'uploaded')
    await db.recordings.update(dropped, { state: 'ready' })
    await storeDownloadedBlob(db, 'other', new Blob(['12345']), 'audio/mp4', 'seed-rev', 0)
    await db.recordings.put({
      id: 'other',
      created_at: AT,
      updated_at: AT,
      deleted_at: null,
      server_seq: 1,
      tune_id: null,
      label: null,
      source: 'microphone',
      origin: 'own',
      origin_url: null,
      added_at: AT,
      recorded_at: AT,
      recorded_precision: 'time',
      position: 0,
      state: 'ready',
      duration_ms: 1000,
      playback_mime: 'audio/mp4',
      playback_bytes: 5,
      error: null,
      trim_start_ms: 0,
      trim_end_ms: null,
      speed_percent: 100,
      pitch_cents: 0,
      source_duration_ms: null,
      playback_start_ms: null,
      playback_end_ms: null,
      playback_rev: null,
      peaks_rev: null,
      split_completed_id: null,
    })
    expect(await localAudioBytes(db)).toBe(4 + 4 + 5)
    await clearDownloadedBlobs(db)
    expect((await db.recording_files.get(kept))?.blob).not.toBeNull()
    expect((await db.recording_files.get(dropped))?.blob).toBeNull()
    expect((await db.recording_files.get('other'))?.blob).toBeNull()
    expect(await localAudioBytes(db)).toBe(4)
  })

  it('keeps blobs stuck in a blocked or failed upload state', async () => {
    const blocked = await captured()
    const failed = await captured()
    await setFileState(db, blocked, 'blocked_quota')
    await setFileState(db, failed, 'failed_upload')
    await clearDownloadedBlobs(db)
    expect((await db.recording_files.get(blocked))?.blob).not.toBeNull()
    expect((await db.recording_files.get(failed))?.blob).not.toBeNull()
  })

  it('only clears an uploaded blob once its recording is ready to play', async () => {
    const ready = await captured()
    const processing = await captured()
    const failed = await captured()
    await setFileState(db, ready, 'uploaded')
    await setFileState(db, processing, 'uploaded')
    await setFileState(db, failed, 'uploaded')
    await db.recordings.update(ready, { state: 'ready' })
    await db.recordings.update(processing, { state: 'processing' })
    await db.recordings.update(failed, { state: 'failed' })
    await clearDownloadedBlobs(db)
    expect((await db.recording_files.get(ready))?.blob).toBeNull()
    expect((await db.recording_files.get(processing))?.blob).not.toBeNull()
    expect((await db.recording_files.get(failed))?.blob).not.toBeNull()
  })
})

describe('addRecordingFromLink', () => {
  const link = {
    url: 'https://www.slippery-hill.com/recording/7',
    provider: 'slippery_hill' as const,
    provider_ref: '7',
    title: 'Slow version',
  }

  it('writes an import row from the link and queues it with no file', async () => {
    const { tuneId } = await createTune(db, { title: 'Reel' }, { status: 'learning' })
    const linkId = await addLink(db, tuneId, link)
    const id = await addRecordingFromLink(db, linkId)
    expect(await db.recordings.get(id)).toMatchObject({
      tune_id: tuneId,
      label: 'Slow version',
      source: 'import',
      origin: 'slippery_hill',
      origin_url: link.url,
      recorded_at: null,
      recorded_precision: null,
      state: 'pending_upload',
    })
    const row = await db.recordings.get(id)
    expect(row?.added_at).toBe(row?.created_at)
    expect(await db.recording_files.get(id)).toBeUndefined()
    expect((await pendingFor(db, 'recordings', id))?.data).toMatchObject({
      tune_id: tuneId,
      label: 'Slow version',
      source: 'import',
      origin: 'slippery_hill',
      origin_url: link.url,
      added_at: row?.created_at,
      recorded_at: null,
      recorded_precision: null,
    })
    expect(await db.outbox.where('table').equals('recordings').count()).toBe(1)
    expect((await db.recording_links.get(linkId))?.deleted_at).toBeNull()
  })

  it('adds the link only once, however often it is asked', async () => {
    const { tuneId } = await createTune(db, { title: 'Reel' }, { status: 'learning' })
    const linkId = await addLink(db, tuneId, link)
    const first = await addRecordingFromLink(db, linkId)
    const second = await addRecordingFromLink(db, linkId)
    expect(second).toBe(first)
    expect(await db.recordings.count()).toBe(1)
    expect(await db.outbox.where('table').equals('recordings').count()).toBe(1)
  })

  it('adds the link once when asked twice at the same time', async () => {
    const { tuneId } = await createTune(db, { title: 'Reel' }, { status: 'learning' })
    const linkId = await addLink(db, tuneId, link)
    const [first, second] = await Promise.all([
      addRecordingFromLink(db, linkId),
      addRecordingFromLink(db, linkId),
    ])
    expect(second).toBe(first)
    expect(await db.recordings.count()).toBe(1)
    expect(await db.outbox.where('table').equals('recordings').count()).toBe(1)
  })

  it('adds the link again once its recording is deleted', async () => {
    const { tuneId } = await createTune(db, { title: 'Reel' }, { status: 'learning' })
    const linkId = await addLink(db, tuneId, link)
    const first = await addRecordingFromLink(db, linkId)
    await deleteRecording(db, first)
    const second = await addRecordingFromLink(db, linkId)
    expect(second).not.toBe(first)
  })

  it('leaves the label empty for an untitled link', async () => {
    const { tuneId } = await createTune(db, { title: 'Reel' }, { status: 'learning' })
    const linkId = await addLink(db, tuneId, { ...link, title: '' })
    const id = await addRecordingFromLink(db, linkId)
    expect((await db.recordings.get(id))?.label).toBeNull()
  })

  it('cuts a long link title to the longest label a recording takes', async () => {
    const { tuneId } = await createTune(db, { title: 'Reel' }, { status: 'learning' })
    const linkId = await addLink(db, tuneId, { ...link, title: '\u{1F3BB}'.repeat(250) })
    const id = await addRecordingFromLink(db, linkId)
    expect((await db.recordings.get(id))?.label).toBe('\u{1F3BB}'.repeat(RECORDING_LIMITS.label))
  })

  it('rejects a link that is missing or removed', async () => {
    await expect(addRecordingFromLink(db, 'nope')).rejects.toThrow(LINK_NOT_FOUND)
    const { tuneId } = await createTune(db, { title: 'Reel' }, { status: 'learning' })
    const linkId = await addLink(db, tuneId, link)
    await removeLink(db, linkId)
    await expect(addRecordingFromLink(db, linkId)).rejects.toThrow(LINK_NOT_FOUND)
  })
})
