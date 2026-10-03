import { unzipSync } from 'fflate'
import { beforeEach, expect, test } from 'vitest'
import type { CrosstuneDb } from '../../../db/schema'
import { openTestDb } from '../../../test/db'
import { recordingFile, recordingRow } from '../../../test/rows'
import { readExportInput } from './runExport'
import { buildZip } from './zip'

// Runs against Chromium's own IndexedDB, where a stored Blob is backed by a file the database
// owns, so it shows whether a Blob read out survives its row going away.

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

const audio = new Uint8Array([1, 2, 3, 4, 5])

async function zippedAfter(change: () => Promise<unknown>): Promise<Uint8Array | undefined> {
  await db.recordings.put(recordingRow('r1'))
  await db.recording_files.put(
    recordingFile('r1', {
      blob: new Blob([audio], { type: 'audio/mp4' }),
      local_state: 'uploaded',
    }),
  )
  const { blobs } = await readExportInput(db, 'user_1', 'UTC')
  await change()
  const zip = await buildZip([{ path: 'r1.m4a', data: blobs.get('r1')! }], { modified: new Date() })
  return unzipSync(new Uint8Array(await zip.arrayBuffer()))['r1.m4a']
}

test('a blob read for the export stays readable after its row is deleted', async () => {
  const bytes = await zippedAfter(() => db.recording_files.delete('r1'))
  expect(bytes).toEqual(audio)
})

test('a blob read for the export keeps its bytes after its row is replaced', async () => {
  const bytes = await zippedAfter(() =>
    db.recording_files.put(
      recordingFile('r1', { blob: new Blob([new Uint8Array([9, 9])]), local_state: 'uploaded' }),
    ),
  )
  expect(bytes).toEqual(audio)
})
