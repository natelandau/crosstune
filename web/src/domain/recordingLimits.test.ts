import { describe, expect, it } from 'vitest'
import type { RecordingFile } from '../db/recordings'
import { recordingRow } from '../test/rows'
import {
  MAX_RECORDING_MS,
  MAX_SPLIT_PIECES,
  MAX_SPLIT_SOURCE_MS,
  MIN_KEPT_MS,
  mustSplitToUpload,
  pieceProblem,
  splitIncomplete,
  splitRangeEnd,
  waitsForCut,
} from './recordingLimits'

const limits = { max_file_bytes: 500, split_parent_max_file_bytes: 2_000 }

const file = (extra: Partial<RecordingFile> = {}) =>
  ({ local_state: 'captured', local_duration_ms: MAX_RECORDING_MS + 1, ...extra }) as RecordingFile

describe('mustSplitToUpload', () => {
  it('holds an unsplit file over the limit', () => {
    expect(mustSplitToUpload(recordingRow('a'), file(), null)).toBe(true)
  })

  it('does not hold a file at the limit, a split row, an uploaded file, or no file', () => {
    expect(
      mustSplitToUpload(recordingRow('a'), file({ local_duration_ms: MAX_RECORDING_MS }), null),
    ).toBe(false)
    expect(mustSplitToUpload(recordingRow('a', { split_id: 's' }), file(), null)).toBe(false)
    expect(mustSplitToUpload(recordingRow('a'), file({ local_state: 'uploaded' }), null)).toBe(
      false,
    )
    expect(mustSplitToUpload(recordingRow('a'), undefined, null)).toBe(false)
  })

  it('holds an unsplit file over the per-file limit even under 3 hours', () => {
    const short = (bytes: number, extra: Partial<RecordingFile> = {}) =>
      file({ local_duration_ms: 60_000, bytes, ...extra })
    expect(mustSplitToUpload(recordingRow('a'), short(501), limits)).toBe(true)
    expect(mustSplitToUpload(recordingRow('a'), short(500), limits)).toBe(false)
    expect(mustSplitToUpload(recordingRow('a'), short(501), null)).toBe(false)
    expect(mustSplitToUpload(recordingRow('a', { split_id: 's' }), short(501), limits)).toBe(false)
    expect(
      mustSplitToUpload(recordingRow('a'), short(501, { local_state: 'uploaded' }), limits),
    ).toBe(false)
  })

  it('does not hold a file that could never upload, even split', () => {
    const overSplitCap = file({ local_duration_ms: 60_000, bytes: 2_001 })
    expect(mustSplitToUpload(recordingRow('a'), overSplitCap, limits)).toBe(false)
    const overTwelveHours = file({ local_duration_ms: MAX_SPLIT_SOURCE_MS + 1, bytes: 1 })
    expect(mustSplitToUpload(recordingRow('a'), overTwelveHours, limits)).toBe(false)
    expect(mustSplitToUpload(recordingRow('a'), overTwelveHours, null)).toBe(false)
    const atTwelveHours = file({ local_duration_ms: MAX_SPLIT_SOURCE_MS, bytes: 2_000 })
    expect(mustSplitToUpload(recordingRow('a'), atTwelveHours, limits)).toBe(true)
  })
})

describe('splitIncomplete', () => {
  it('is false for a recording that was never split', () => {
    expect(splitIncomplete(recordingRow('p'))).toBe(false)
  })

  it('is true after a split until the server reports it complete', () => {
    expect(splitIncomplete(recordingRow('p', { split_id: 's', split_size: 3 }))).toBe(true)
  })

  it('is false once the pulled row carries the completed split', () => {
    const row = recordingRow('p', { split_id: 's', split_size: 3, split_completed_id: 's' })
    expect(splitIncomplete(row)).toBe(false)
  })

  it('is true again when a later split replaces the completed one', () => {
    const row = recordingRow('p', { split_id: 't', split_size: 2, split_completed_id: 's' })
    expect(splitIncomplete(row)).toBe(true)
  })
})

describe('splitRangeEnd', () => {
  it('reads the trim end, then the source, the playback, and the local file length', () => {
    const row = { trim_end_ms: 4, source_duration_ms: 3, duration_ms: 2 }
    const local = { local_duration_ms: 1 }
    expect(splitRangeEnd(row, local)).toBe(4)
    expect(splitRangeEnd({ ...row, trim_end_ms: null }, local)).toBe(3)
    expect(splitRangeEnd({ ...row, trim_end_ms: null, source_duration_ms: null }, local)).toBe(2)
    const bare = { trim_end_ms: null, source_duration_ms: null, duration_ms: null }
    expect(splitRangeEnd(bare, local)).toBe(1)
    expect(splitRangeEnd(bare, undefined)).toBeNull()
  })
})

describe('pieceProblem', () => {
  it('accepts pieces of at least the shortest kept range', () => {
    expect(pieceProblem([0, MIN_KEPT_MS, 2 * MIN_KEPT_MS], false)).toBeNull()
  })

  it('refuses a short piece, too many pieces, and a long piece only over the limit', () => {
    expect(pieceProblem([0, MIN_KEPT_MS - 1, 5000], false)).toBe('too-short')
    const many = Array.from({ length: MAX_SPLIT_PIECES + 2 }, (_, i) => i * MIN_KEPT_MS)
    expect(pieceProblem(many, false)).toBe('too-many')
    const long = [0, MAX_RECORDING_MS + 1, MAX_RECORDING_MS + 5000]
    expect(pieceProblem(long, true)).toBe('too-long')
    expect(pieceProblem(long, false)).toBeNull()
  })
})

describe('waitsForCut', () => {
  const piece = recordingRow('p', { split_from_id: 'parent', state: 'processing' })

  it('holds for a live processing piece only', () => {
    expect(waitsForCut(piece)).toBe(true)
    expect(waitsForCut({ ...piece, state: 'failed' })).toBe(false)
    expect(waitsForCut({ ...piece, state: 'ready' })).toBe(false)
    expect(waitsForCut({ ...piece, deleted_at: '2026-01-01T00:00:00Z' })).toBe(false)
    expect(waitsForCut({ ...piece, split_from_id: null })).toBe(false)
  })
})
