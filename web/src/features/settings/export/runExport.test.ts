import { unzipSync } from 'fflate'
import { expect, test, vi } from 'vitest'
import type { CrosstuneDb } from '../../../db/schema'
import { settingsId } from '../../../commands/settings'
import { openTestDb } from '../../../test/db'
import {
  scanFile,
  scanRow,
  recordingFile,
  recordingRow,
  tuneRow,
  userTuneRow,
} from '../../../test/rows'
import { createExport, downloadBlob, exportCounts, readExportInput } from './runExport'

const USER = 'user_1'
const ZONE = 'America/New_York'
const NOW = new Date('2026-10-02T15:00:00Z')

const audio = (bytes: number[], type = 'audio/mp4') => new Blob([new Uint8Array(bytes)], { type })

/** Serves every missing file as the same two bytes, so a test can tell fetched from local. */
const fetchMissing = vi.fn(async (_kind: 'recording' | 'scan', _id: string) => audio([5, 5]))

const options = (extra: Partial<Parameters<typeof createExport>[2]> = {}) => ({
  now: NOW,
  timeZone: ZONE,
  fetchMissing,
  ...extra,
})

async function seed(db: CrosstuneDb) {
  await db.tunes.put(tuneRow('t1', 'Cluck Old Hen'))
  await db.user_tunes.put(userTuneRow('u1', 't1'))
  await db.recordings.bulkPut([
    recordingRow('r-ok', { tune_id: 't1', added_at: '2026-09-20T12:00:00.000Z' }),
    recordingRow('r-capturing', { tune_id: 't1', state: 'pending_upload' }),
    recordingRow('r-downloading', { tune_id: 't1', playback_mime: 'audio/mp4' }),
    recordingRow('r-deleted', { tune_id: 't1', deleted_at: '2026-09-21T00:00:00.000Z' }),
  ])
  await db.recording_files.bulkPut([
    recordingFile('r-ok', { blob: audio([1, 2, 3]), local_state: 'uploaded' }),
    recordingFile('r-capturing', { blob: audio([9]), local_state: 'capturing' }),
    recordingFile('r-downloading', { blob: null, local_state: 'downloading' }),
    recordingFile('r-deleted', { blob: audio([7]), local_state: 'uploaded' }),
  ])
}

test('counts complete local audio as on device and a ready recording without it as missing', async () => {
  const db = openTestDb()
  await seed(db)
  expect(await exportCounts(db)).toEqual({ onDevice: 1, total: 2, missing: 1 })
})

test('counts scans the device holds and ready scans it does not', async () => {
  const db = openTestDb()
  await seed(db)
  await db.scans.bulkPut([
    scanRow('p-here', 't1'),
    scanRow('p-away', 't1', { position: 1 }),
    scanRow('p-pending', 't1', { position: 2, state: 'pending_upload' }),
  ])
  await db.scan_files.put(scanFile('p-here', audio([7], 'image/jpeg')))
  expect(await exportCounts(db)).toEqual({ onDevice: 2, total: 4, missing: 2 })
})

test('counts leave out a scan on a tune the export leaves out', async () => {
  const db = openTestDb()
  await db.tunes.put(tuneRow('t-gone', 'Gone'))
  await db.user_tunes.put(
    userTuneRow('u-gone', 't-gone', { deleted_at: '2026-09-21T00:00:00.000Z' }),
  )
  await db.scans.put(scanRow('p-gone', 't-gone'))
  expect(await exportCounts(db)).toEqual({ onDevice: 0, total: 0, missing: 0 })
  const { blob } = await createExport(db, USER, options())
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  expect(Object.keys(files)).toEqual(['tunes.csv', 'lists.csv', 'recordings.csv'])
})

test('an audio file with no recording row is neither counted nor exported', async () => {
  const db = openTestDb()
  await seed(db)
  await db.recording_files.put(
    recordingFile('r-orphan', { blob: audio([5]), local_state: 'downloaded' }),
  )
  expect(await exportCounts(db)).toEqual({ onDevice: 1, total: 2, missing: 1 })
  const { blob } = await createExport(db, USER, options())
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  expect(Object.keys(files)).toEqual([
    'tunes.csv',
    'lists.csv',
    'recordings.csv',
    'recordings/Cluck Old Hen/2026-01-01.m4a',
    'recordings/Cluck Old Hen/2026-09-20.m4a',
  ])
})

test('a capturing file is not exportable and a ready recording without a blob is fetched', async () => {
  const db = openTestDb()
  await seed(db)
  const { input, blobs } = await readExportInput(db, USER, ZONE)
  expect(input.audio.map((a) => a.recordingId).sort()).toEqual([
    'r-deleted',
    'r-downloading',
    'r-ok',
  ])
  expect([...blobs.keys()].sort()).toEqual(['r-deleted', 'r-ok'])
})

test('reads the content type from the blob, falling back to the stored mime', async () => {
  const db = openTestDb()
  await db.recordings.put(recordingRow('a'))
  await db.recordings.put(recordingRow('b'))
  await db.recording_files.bulkPut([
    recordingFile('a', { blob: audio([1], ''), mime: 'audio/webm' }),
    recordingFile('b', { blob: audio([1], 'audio/mp4'), mime: 'audio/webm' }),
  ])
  const { input } = await readExportInput(db, USER, ZONE)
  expect(input.audio).toEqual([
    { recordingId: 'a', contentType: 'audio/webm' },
    { recordingId: 'b', contentType: 'audio/mp4' },
  ])
})

test('reads the chosen instruments from the settings row', async () => {
  const db = openTestDb()
  await db.user_settings.put({
    id: settingsId(USER),
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
    server_seq: 0,
    instruments: ['violin'],
    audio_quality: 'standard',
    play_first: 'recordings',
    new_tune_genre: null,
    new_tune_status: 'want_to_learn',
    tuner_a4_hz: 440,
  })
  const { input } = await readExportInput(db, USER, ZONE)
  expect(input.instruments).toEqual(['violin'])
  expect(input.timeZone).toBe(ZONE)
})

test('builds a zip of the CSVs and the audio, named for the local date', async () => {
  const db = openTestDb()
  await seed(db)
  const { fileName, blob } = await createExport(db, USER, options())
  expect(fileName).toBe('crosstune-export-2026-10-02.zip')
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  expect(Object.keys(files)).toEqual([
    'tunes.csv',
    'lists.csv',
    'recordings.csv',
    'recordings/Cluck Old Hen/2026-01-01.m4a',
    'recordings/Cluck Old Hen/2026-09-20.m4a',
  ])
  expect(files['recordings/Cluck Old Hen/2026-09-20.m4a']).toEqual(new Uint8Array([1, 2, 3]))
})

test('fetches a recording and a scan the device does not hold into the zip without storing them', async () => {
  const db = openTestDb()
  await db.tunes.put(tuneRow('t1', 'Cluck Old Hen'))
  await db.user_tunes.put(userTuneRow('u1', 't1'))
  await db.recordings.put(
    recordingRow('r-away', {
      tune_id: 't1',
      playback_mime: 'audio/mp4',
      added_at: NOW.toISOString(),
    }),
  )
  await db.scans.put(scanRow('p-away', 't1'))
  const fetchAway = vi.fn(async (kind: 'recording' | 'scan', _id: string) =>
    kind === 'recording' ? audio([1, 1]) : audio([2, 2], 'image/jpeg'),
  )

  const { blob } = await createExport(db, USER, options({ fetchMissing: fetchAway }))

  expect(fetchAway.mock.calls.map(([kind, id]) => [kind, id])).toEqual([
    ['recording', 'r-away'],
    ['scan', 'p-away'],
  ])
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  expect(files['recordings/Cluck Old Hen/2026-10-02.m4a']).toEqual(new Uint8Array([1, 1]))
  expect(files['scans/Cluck Old Hen/1.jpg']).toEqual(new Uint8Array([2, 2]))
  expect(await db.recording_files.count()).toBe(0)
  expect(await db.scan_files.count()).toBe(0)
})

test('fails with the fetch error, and builds no zip, when a missing file cannot be fetched', async () => {
  const db = openTestDb()
  await seed(db)
  await expect(
    createExport(db, USER, options({ fetchMissing: () => Promise.reject(new Error('offline')) })),
  ).rejects.toThrow('offline')
})

test('zips each scan whose image is on the device, and counts it in progress', async () => {
  const db = openTestDb()
  await seed(db)
  await db.scans.bulkPut([
    scanRow('p2', 't1', { position: 1 }),
    scanRow('p1', 't1', { position: 0 }),
    scanRow('p-away', 't1', { position: 2 }),
  ])
  await db.scan_files.bulkPut([
    scanFile('p1', audio([7], 'image/jpeg')),
    scanFile('p2', audio([8], 'image/jpeg')),
  ])
  const onProgress = vi.fn()
  const { blob } = await createExport(db, USER, options({ onProgress }))
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  expect(files['scans/Cluck Old Hen/1.jpg']).toEqual(new Uint8Array([7]))
  expect(files['scans/Cluck Old Hen/2.jpg']).toEqual(new Uint8Array([8]))
  expect(files['scans/Cluck Old Hen/3.jpg']).toEqual(new Uint8Array([5, 5]))
  expect(Object.keys(files).filter((path) => path.startsWith('scans/'))).toHaveLength(3)
  expect(onProgress.mock.calls.at(-1)).toEqual([5, 5])
})

test('names the zip for the date in the time zone, not UTC', async () => {
  const db = openTestDb()
  const { fileName } = await createExport(
    db,
    USER,
    options({ now: new Date('2026-10-03T02:00:00Z') }),
  )
  expect(fileName).toBe('crosstune-export-2026-10-02.zip')
})

test('an empty store still yields every CSV', async () => {
  const db = openTestDb()
  const { blob } = await createExport(db, USER, options())
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  expect(Object.keys(files)).toEqual(['tunes.csv', 'lists.csv', 'recordings.csv'])
})

test('reports audio progress from zero, excluding the CSVs', async () => {
  const db = openTestDb()
  await seed(db)
  await db.recordings.put(recordingRow('r2', { tune_id: 't1', position: 1 }))
  await db.recording_files.put(recordingFile('r2', { blob: audio([4]), local_state: 'downloaded' }))
  const onProgress = vi.fn()
  await createExport(db, USER, options({ onProgress }))
  expect(onProgress.mock.calls).toEqual([
    [0, 3],
    [1, 3],
    [2, 3],
    [3, 3],
  ])
})

test('a Cancel mid-fetch hands the fetch the signal and rejects without waiting for it', async () => {
  const db = openTestDb()
  await seed(db)
  const controller = new AbortController()
  // A fetch that never settles, so only the abort can end the export.
  const stalled = vi.fn(
    (_kind: 'recording' | 'scan', _id: string, _signal?: AbortSignal) =>
      new Promise<Blob>(() => {}),
  )
  const running = createExport(
    db,
    USER,
    options({ fetchMissing: stalled, signal: controller.signal }),
  )
  await expect.poll(() => stalled.mock.calls.length).toBe(1)
  expect(stalled.mock.calls[0]![2]).toBe(controller.signal)
  controller.abort(new Error('cancelled'))
  await expect(running).rejects.toThrow('cancelled')
})

test('rejects with the abort reason', async () => {
  const db = openTestDb()
  await seed(db)
  const controller = new AbortController()
  controller.abort(new Error('stop'))
  await expect(createExport(db, USER, options({ signal: controller.signal }))).rejects.toThrow(
    'stop',
  )
})

test('downloadBlob clicks a detached download link and revokes the URL afterward', () => {
  vi.useFakeTimers()
  const create = vi.fn(() => 'blob:x')
  const revoke = vi.fn()
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    expect(this.download).toBe('a.zip')
    expect(this.getAttribute('href')).toBe('blob:x')
    expect(this.isConnected).toBe(false)
  })
  downloadBlob(new Blob(['x']), 'a.zip')
  expect(click).toHaveBeenCalledOnce()
  expect(revoke).not.toHaveBeenCalled()
  vi.runAllTimers()
  expect(revoke).toHaveBeenCalledWith('blob:x')
  click.mockRestore()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
