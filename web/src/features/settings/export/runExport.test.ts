import { unzipSync } from 'fflate'
import { expect, test, vi } from 'vitest'
import type { CrosstuneDb } from '../../../db/schema'
import { settingsId } from '../../../commands/settings'
import { openTestDb } from '../../../test/db'
import {
  notationFile,
  notationPageRow,
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

async function seed(db: CrosstuneDb) {
  await db.tunes.put(tuneRow('t1', 'Cluck Old Hen'))
  await db.user_tunes.put(userTuneRow('u1', 't1'))
  await db.recordings.bulkPut([
    recordingRow('r-ok', { tune_id: 't1', added_at: '2026-09-20T12:00:00.000Z' }),
    recordingRow('r-capturing', { tune_id: 't1' }),
    recordingRow('r-downloading', { tune_id: 't1' }),
    recordingRow('r-deleted', { tune_id: 't1', deleted_at: '2026-09-21T00:00:00.000Z' }),
  ])
  await db.recording_files.bulkPut([
    recordingFile('r-ok', { blob: audio([1, 2, 3]), local_state: 'uploaded' }),
    recordingFile('r-capturing', { blob: audio([9]), local_state: 'capturing' }),
    recordingFile('r-downloading', { blob: null, local_state: 'downloading' }),
    recordingFile('r-deleted', { blob: audio([7]), local_state: 'uploaded' }),
  ])
}

test('counts only complete local audio as on device', async () => {
  const db = openTestDb()
  await seed(db)
  expect(await exportCounts(db)).toEqual({ onDevice: 1, total: 3 })
})

test('an audio file with no recording row is neither counted nor exported', async () => {
  const db = openTestDb()
  await seed(db)
  await db.recording_files.put(
    recordingFile('r-orphan', { blob: audio([5]), local_state: 'downloaded' }),
  )
  expect(await exportCounts(db)).toEqual({ onDevice: 1, total: 3 })
  const { blob } = await createExport(db, USER, { now: NOW, timeZone: ZONE })
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  expect(Object.keys(files)).toEqual([
    'tunes.csv',
    'lists.csv',
    'recordings/Cluck Old Hen/2026-09-20.m4a',
  ])
})

test('a capturing file is not exportable and a downloading file without a blob is missing', async () => {
  const db = openTestDb()
  await seed(db)
  const { input, blobs } = await readExportInput(db, USER, ZONE)
  expect(input.localAudio.map((a) => a.recordingId).sort()).toEqual(['r-deleted', 'r-ok'])
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
  expect(input.localAudio).toEqual([
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
  })
  const { input } = await readExportInput(db, USER, ZONE)
  expect(input.instruments).toEqual(['violin'])
  expect(input.timeZone).toBe(ZONE)
})

test('builds a zip of both CSVs and the audio, named for the local date', async () => {
  const db = openTestDb()
  await seed(db)
  const { fileName, blob } = await createExport(db, USER, { now: NOW, timeZone: ZONE })
  expect(fileName).toBe('crosstune-export-2026-10-02.zip')
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  expect(Object.keys(files)).toEqual([
    'tunes.csv',
    'lists.csv',
    'recordings/Cluck Old Hen/2026-09-20.m4a',
  ])
  expect(files['recordings/Cluck Old Hen/2026-09-20.m4a']).toEqual(new Uint8Array([1, 2, 3]))
})

test('zips each notation page whose image is on the device, and counts it in progress', async () => {
  const db = openTestDb()
  await seed(db)
  await db.notation_pages.bulkPut([
    notationPageRow('p2', 't1', { position: 1 }),
    notationPageRow('p1', 't1', { position: 0 }),
    notationPageRow('p-away', 't1', { position: 2 }),
  ])
  await db.notation_files.bulkPut([
    notationFile('p1', audio([7], 'image/jpeg')),
    notationFile('p2', audio([8], 'image/jpeg')),
  ])
  const onProgress = vi.fn()
  const { blob } = await createExport(db, USER, { now: NOW, timeZone: ZONE, onProgress })
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  expect(files['notation/Cluck Old Hen/1.jpg']).toEqual(new Uint8Array([7]))
  expect(files['notation/Cluck Old Hen/2.jpg']).toEqual(new Uint8Array([8]))
  expect(Object.keys(files).filter((path) => path.startsWith('notation/'))).toHaveLength(2)
  expect(onProgress.mock.calls.at(-1)).toEqual([3, 3])
})

test('names the zip for the date in the time zone, not UTC', async () => {
  const db = openTestDb()
  const { fileName } = await createExport(db, USER, {
    now: new Date('2026-10-03T02:00:00Z'),
    timeZone: ZONE,
  })
  expect(fileName).toBe('crosstune-export-2026-10-02.zip')
})

test('an empty store still yields both CSVs', async () => {
  const db = openTestDb()
  const { blob } = await createExport(db, USER, { now: NOW, timeZone: ZONE })
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  expect(Object.keys(files)).toEqual(['tunes.csv', 'lists.csv'])
})

test('reports audio progress from zero, excluding the CSVs', async () => {
  const db = openTestDb()
  await seed(db)
  await db.recordings.put(recordingRow('r2', { tune_id: 't1', position: 1 }))
  await db.recording_files.put(recordingFile('r2', { blob: audio([4]), local_state: 'downloaded' }))
  const onProgress = vi.fn()
  await createExport(db, USER, { now: NOW, timeZone: ZONE, onProgress })
  expect(onProgress.mock.calls).toEqual([
    [0, 2],
    [1, 2],
    [2, 2],
  ])
})

test('rejects with the abort reason', async () => {
  const db = openTestDb()
  await seed(db)
  const controller = new AbortController()
  controller.abort(new Error('stop'))
  await expect(
    createExport(db, USER, { now: NOW, timeZone: ZONE, signal: controller.signal }),
  ).rejects.toThrow('stop')
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
