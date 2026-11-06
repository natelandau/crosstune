import { describe, expect, it } from 'vitest'
import type { RecordingState } from '../../api/vocabulary'
import {
  playlistReport,
  playlistSource,
  type PlaylistEntry,
  type PlaylistRecording,
} from './listSource'

const TUNE = 'tune-1'

function rec(
  id: string,
  extra: Partial<{ tune_id: string; deleted_at: string | null; state: RecordingState }> = {},
): PlaylistRecording {
  return { id, tune_id: TUNE, deleted_at: null, state: 'ready', ...extra }
}

function entry(input: Partial<PlaylistEntry> = {}): PlaylistEntry {
  return { tuneId: TUNE, pin: { recordingId: null }, recordings: [], ...input }
}

const held =
  (...ids: string[]) =>
  (id: string) =>
    ids.includes(id)

describe('playlistSource', () => {
  it('plays the pinned recording when it can play here', () => {
    const result = playlistSource({
      ...entry({ pin: { recordingId: 'r2' }, recordings: [rec('r1'), rec('r2')] }),
      online: true,
      recordingsPlay: true,
      hasAudio: held(),
    })
    expect(result).toEqual({ kind: 'recording', id: 'r2' })
  })

  it('plays the first recording when nothing is pinned', () => {
    const result = playlistSource({
      ...entry({ recordings: [rec('r1'), rec('r2')] }),
      online: true,
      recordingsPlay: true,
      hasAudio: held(),
    })
    expect(result).toEqual({ kind: 'recording', id: 'r1' })
  })

  it('falls through from a pinned recording without audio offline to one with audio', () => {
    const result = playlistSource({
      ...entry({ pin: { recordingId: 'r1' }, recordings: [rec('r1'), rec('r2'), rec('r3')] }),
      online: false,
      recordingsPlay: true,
      hasAudio: held('r3'),
    })
    expect(result).toEqual({ kind: 'recording', id: 'r3' })
  })

  it('skips offline when no recording has its audio on this device', () => {
    const result = playlistSource({
      ...entry({ recordings: [rec('r1')] }),
      online: false,
      recordingsPlay: true,
      hasAudio: held(),
    })
    expect(result).toBeNull()
  })

  it('skips online when no recording has audio the server can send', () => {
    const result = playlistSource({
      ...entry({ recordings: [rec('r1', { state: 'pending_upload' })] }),
      online: true,
      recordingsPlay: true,
      hasAudio: held(),
    })
    expect(result).toBeNull()
  })

  it('skips a tune with no recordings', () => {
    expect(
      playlistSource({ ...entry(), online: true, recordingsPlay: true, hasAudio: held() }),
    ).toBeNull()
  })

  it('counts only live rows that belong to the tune', () => {
    const result = playlistSource({
      ...entry({
        pin: { recordingId: 'other' },
        recordings: [rec('gone', { deleted_at: '2026-01-01' }), rec('other', { tune_id: 'x' })],
      }),
      online: true,
      recordingsPlay: true,
      hasAudio: held('gone', 'other'),
    })
    expect(result).toBeNull()
  })
})

describe('playlistSource while recordings cannot play', () => {
  const free = { online: true, recordingsPlay: false, hasAudio: held('r1') }

  it('skips a tune holding only recordings, even with its audio here', () => {
    const result = playlistSource({
      ...entry({ pin: { recordingId: 'r1' }, recordings: [rec('r1')] }),
      ...free,
    })
    expect(result).toBeNull()
  })

  it('plays the pinned recording once recordings can play', () => {
    const result = playlistSource({
      ...entry({ pin: { recordingId: 'r1' }, recordings: [rec('r1')] }),
      ...free,
      recordingsPlay: true,
    })
    expect(result).toEqual({ kind: 'recording', id: 'r1' })
  })
})

describe('playlistReport', () => {
  it('lists the playable tunes in list order', () => {
    const report = playlistReport(
      [
        entry({ tuneId: 'a', recordings: [rec('ra', { tune_id: 'a' })] }),
        entry({ tuneId: 'b' }),
        entry({ tuneId: 'c' }),
        entry({ tuneId: 'd', recordings: [rec('rd', { tune_id: 'd' })] }),
        entry({ tuneId: 'e', recordings: [rec('re', { tune_id: 'e' })] }),
      ],
      { online: false, recordingsPlay: true, hasAudio: held('ra', 'rd') },
    )
    expect(report).toEqual({
      playable: ['a', 'd'],
      total: 5,
    })
  })

  it('reports nothing playable when offline with no audio on this device', () => {
    const report = playlistReport(
      [
        entry({ tuneId: 'a', recordings: [rec('ra', { tune_id: 'a' })] }),
        entry({ tuneId: 'b', recordings: [rec('rb', { tune_id: 'b' })] }),
      ],
      { online: false, recordingsPlay: true, hasAudio: held() },
    )
    expect(report.playable).toEqual([])
    expect(report.total).toBe(2)
  })

  it('reports nothing playable while recordings cannot play', () => {
    const report = playlistReport(
      [entry({ tuneId: 'a', recordings: [rec('ra', { tune_id: 'a' })] }), entry({ tuneId: 'b' })],
      { online: true, recordingsPlay: false, hasAudio: held('ra') },
    )
    expect(report.playable).toEqual([])
    expect(report.total).toBe(2)
  })
})
