import { describe, expect, it } from 'vitest'
import { recordingFile, recordingRow } from '../../test/rows'
import { openTestDb } from '../../test/db'
import { audioFileFor, loadAudioFile, playbackWindow } from './playbackWindow'

describe('playbackWindow', () => {
  it('offsets by nothing for a captured blob, which starts at the source', () => {
    const row = recordingRow('rec_1', { trim_start_ms: 2000, trim_end_ms: 8000 })
    const file = recordingFile('rec_1', { blob_start_ms: 0, local_duration_ms: 10_000 })
    expect(playbackWindow(row, file)).toEqual({ fromS: 2, toS: 8, lengthMs: 6000 })
  })

  it('offsets by the blob start for a current downloaded blob', () => {
    const row = recordingRow('rec_1', {
      trim_start_ms: 1000,
      trim_end_ms: 9000,
      playback_start_ms: 1000,
      playback_end_ms: 9000,
    })
    const file = recordingFile('rec_1', { blob_start_ms: 1000, local_duration_ms: 8000 })
    expect(playbackWindow(row, file)).toEqual({ fromS: 0, toS: 8, lengthMs: 8000 })
  })

  it('trusts the actual blob start over the row for a stale downloaded blob', () => {
    // The row already points at a newer trim (playback_start_ms 500), but this device is
    // still playing the blob downloaded for the previous one.
    const row = recordingRow('rec_1', {
      trim_start_ms: 1500,
      trim_end_ms: 9000,
      playback_start_ms: 500,
      playback_end_ms: 9000,
    })
    const file = recordingFile('rec_1', { blob_start_ms: 1000, local_duration_ms: 8000 })
    expect(playbackWindow(row, file)).toEqual({ fromS: 0.5, toS: 8, lengthMs: 7500 })
  })

  it('uses source_duration_ms when trim_end_ms is null', () => {
    const row = recordingRow('rec_1', {
      trim_start_ms: 0,
      trim_end_ms: null,
      source_duration_ms: 7000,
    })
    const file = recordingFile('rec_1', { blob_start_ms: 0, local_duration_ms: 7000 })
    expect(playbackWindow(row, file)).toEqual({ fromS: 0, toS: 7, lengthMs: 7000 })
  })

  it('clamps to the blob when the computed end runs past it', () => {
    const row = recordingRow('rec_1', { trim_start_ms: 0, trim_end_ms: 9000 })
    const file = recordingFile('rec_1', { blob_start_ms: 0, local_duration_ms: 5000 })
    expect(playbackWindow(row, file)).toEqual({ fromS: 0, toS: 5, lengthMs: 5000 })
  })

  it('clamps only at zero when the blob duration is unknown', () => {
    const row = recordingRow('rec_1', { trim_start_ms: 0, trim_end_ms: 9000 })
    const file = recordingFile('rec_1', { blob_start_ms: 0, local_duration_ms: null })
    expect(playbackWindow(row, file)).toEqual({ fromS: 0, toS: 9, lengthMs: 9000 })
  })

  it('leaves the end open when nothing says how long the recording is', () => {
    const row = recordingRow('rec_1', {
      trim_start_ms: 0,
      trim_end_ms: null,
      source_duration_ms: null,
    })
    const file = recordingFile('rec_1', { blob_start_ms: 0, local_duration_ms: null })
    expect(playbackWindow(row, file)).toEqual({ fromS: 0, toS: Infinity, lengthMs: 0 })
  })

  it('never returns a negative offset when the blob starts after the trim start', () => {
    const row = recordingRow('rec_1', { trim_start_ms: 0, trim_end_ms: 4000 })
    const file = recordingFile('rec_1', { blob_start_ms: 1000, local_duration_ms: 3000 })
    expect(playbackWindow(row, file)).toEqual({ fromS: 0, toS: 3, lengthMs: 3000 })
  })
})

describe('audioFileFor', () => {
  const blob = new Blob(['x'])
  const parent = recordingFile('rec_parent', { blob, blob_start_ms: 0, local_duration_ms: 180_000 })

  it('plays a processing piece range from its parent blob', () => {
    const piece = recordingRow('rec_piece', {
      split_from_id: 'rec_parent',
      state: 'processing',
      trim_start_ms: 60_000,
      trim_end_ms: 120_000,
    })
    const file = audioFileFor(piece, undefined, parent)
    expect(file).toBe(parent)
    expect(playbackWindow(piece, file!)).toEqual({ fromS: 60, toS: 120, lengthMs: 60_000 })
  })

  it('uses a ready piece own file', () => {
    const piece = recordingRow('rec_piece', { split_from_id: 'rec_parent', state: 'ready' })
    const own = recordingFile('rec_piece', { blob })
    expect(audioFileFor(piece, own, parent)).toBe(own)
    expect(audioFileFor(piece, undefined, parent)).toBeUndefined()
  })

  it('uses nothing when the parent holds no audio or the row is not a piece', () => {
    const piece = recordingRow('rec_piece', { split_from_id: 'rec_parent', state: 'processing' })
    expect(audioFileFor(piece, undefined, { ...parent, blob: null })).toBeUndefined()
    expect(audioFileFor(piece, undefined, undefined)).toBeUndefined()
    const plain = recordingRow('rec_plain', { state: 'processing' })
    expect(audioFileFor(plain, undefined, parent)).toBeUndefined()
  })

  it("does not play a failed piece from its parent's audio", () => {
    const piece = recordingRow('rec_piece', { split_from_id: 'rec_parent', state: 'failed' })
    expect(audioFileFor(piece, undefined, parent)).toBeUndefined()
  })
})

describe('loadAudioFile', () => {
  it("reads a waiting piece's parent file, and nothing for no row", async () => {
    const db = openTestDb()
    const blob = new Blob(['x'])
    await db.recording_files.put(recordingFile('rec_parent', { blob }))
    const piece = recordingRow('rec_piece', { split_from_id: 'rec_parent', state: 'processing' })
    expect((await loadAudioFile(db, piece))?.id).toBe('rec_parent')
    expect(await loadAudioFile(db, null)).toBeUndefined()
  })
})
