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

function link(id: string, extra: Partial<{ tune_id: string; deleted_at: string | null }> = {}) {
  return { id, tune_id: TUNE, deleted_at: null, ...extra }
}

function entry(input: Partial<PlaylistEntry> = {}): PlaylistEntry {
  return { tuneId: TUNE, pin: { recordingId: null }, recordings: [], links: [], ...input }
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
    expect(result).toEqual({ item: { kind: 'recording', id: 'r2' } })
  })

  it('plays the first recording when nothing is pinned', () => {
    const result = playlistSource({
      ...entry({ recordings: [rec('r1'), rec('r2')] }),
      online: true,
      recordingsPlay: true,
      hasAudio: held(),
    })
    expect(result).toEqual({ item: { kind: 'recording', id: 'r1' } })
  })

  it('falls through from a pinned recording without audio offline to one with audio', () => {
    const result = playlistSource({
      ...entry({ pin: { recordingId: 'r1' }, recordings: [rec('r1'), rec('r2'), rec('r3')] }),
      online: false,
      recordingsPlay: true,
      hasAudio: held('r3'),
    })
    expect(result).toEqual({ item: { kind: 'recording', id: 'r3' } })
  })

  it('skips notHere offline when no recording has its audio on this device', () => {
    const result = playlistSource({
      ...entry({ recordings: [rec('r1')], links: [link('l1')] }),
      online: false,
      recordingsPlay: true,
      hasAudio: held(),
    })
    expect(result).toEqual({ skip: 'notHere' })
  })

  it('skips notHere online when no recording has audio the server can send', () => {
    const result = playlistSource({
      ...entry({ recordings: [rec('r1', { state: 'pending_upload' })] }),
      online: true,
      recordingsPlay: true,
      hasAudio: held(),
    })
    expect(result).toEqual({ skip: 'notHere' })
  })

  it('skips linksOnly for a tune with only links', () => {
    const result = playlistSource({
      ...entry({ links: [link('l1')] }),
      online: true,
      recordingsPlay: true,
      hasAudio: held(),
    })
    expect(result).toEqual({ skip: 'linksOnly' })
  })

  it('skips nothing for a tune with no recordings or links', () => {
    expect(
      playlistSource({ ...entry(), online: true, recordingsPlay: true, hasAudio: held() }),
    ).toEqual({
      skip: 'nothing',
    })
  })

  it('counts only live rows that belong to the tune', () => {
    const result = playlistSource({
      ...entry({
        pin: { recordingId: 'other' },
        recordings: [rec('gone', { deleted_at: '2026-01-01' }), rec('other', { tune_id: 'x' })],
        links: [link('l-gone', { deleted_at: '2026-01-01' })],
      }),
      online: true,
      recordingsPlay: true,
      hasAudio: held('gone', 'other'),
    })
    expect(result).toEqual({ skip: 'nothing' })
  })
})

describe('playlistSource while recordings cannot play', () => {
  const free = { online: true, recordingsPlay: false, hasAudio: held('r1') }

  it('skips premium for a tune holding only recordings, even with its audio here', () => {
    const result = playlistSource({
      ...entry({ pin: { recordingId: 'r1' }, recordings: [rec('r1')] }),
      ...free,
    })
    expect(result).toEqual({ skip: 'premium' })
  })

  it('skips linksOnly for a pinned recording beside a link, as for a missing recording', () => {
    const result = playlistSource({
      ...entry({ pin: { recordingId: 'r1' }, recordings: [rec('r1')], links: [link('l1')] }),
      ...free,
    })
    expect(result).toEqual({ skip: 'linksOnly' })
  })

  it('plays the pinned recording once recordings can play', () => {
    const result = playlistSource({
      ...entry({ pin: { recordingId: 'r1' }, recordings: [rec('r1')], links: [link('l1')] }),
      ...free,
      recordingsPlay: true,
    })
    expect(result).toEqual({ item: { kind: 'recording', id: 'r1' } })
  })
})

describe('playlistReport', () => {
  it('sorts the entries into playable tunes and skips by reason, in list order', () => {
    const report = playlistReport(
      [
        entry({ tuneId: 'a', recordings: [rec('ra', { tune_id: 'a' })] }),
        entry({ tuneId: 'b', links: [link('lb', { tune_id: 'b' })] }),
        entry({ tuneId: 'c' }),
        entry({ tuneId: 'd', recordings: [rec('rd', { tune_id: 'd' })] }),
        entry({ tuneId: 'e', recordings: [rec('re', { tune_id: 'e' })] }),
      ],
      { online: false, recordingsPlay: true, hasAudio: held('ra', 'rd') },
    )
    expect(report).toEqual({
      playable: ['a', 'd'],
      skipped: { nothing: ['c'], linksOnly: ['b'], notHere: ['e'], premium: [] },
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
    expect(report.skipped.notHere).toEqual(['a', 'b'])
    expect(report.total).toBe(2)
  })

  it('reports tunes holding only recordings as premium while recordings cannot play', () => {
    const report = playlistReport(
      [
        entry({ tuneId: 'a', recordings: [rec('ra', { tune_id: 'a' })] }),
        entry({ tuneId: 'b', links: [link('lb', { tune_id: 'b' })] }),
      ],
      { online: true, recordingsPlay: false, hasAudio: held('ra') },
    )
    expect(report.playable).toEqual([])
    expect(report.skipped).toEqual({ nothing: [], linksOnly: ['b'], notHere: [], premium: ['a'] })
  })
})
