import { describe, expect, it } from 'vitest'
import type { PlayFirst } from '../../api/vocabulary'
import type { LocalRecording, LocalRecordingLink } from '../../db/types'
import { chooseRowSource } from './tuneSource'

const TUNE = 'tune-1'

function rec(id: string, extra: Partial<LocalRecording> = {}): LocalRecording {
  return { id, tune_id: TUNE, deleted_at: null, ...extra } as LocalRecording
}

function link(id: string, provider: string, extra: Partial<LocalRecordingLink> = {}) {
  return { id, tune_id: TUNE, provider, deleted_at: null, ...extra } as LocalRecordingLink
}

const NO_PIN = { recordingId: null, linkId: null }

function choose(
  input: Partial<{
    pin: { recordingId: string | null; linkId: string | null }
    recordings: LocalRecording[]
    links: LocalRecordingLink[]
    playFirst: PlayFirst
  }>,
) {
  return chooseRowSource({
    tuneId: TUNE,
    pin: NO_PIN,
    recordings: [],
    links: [],
    playFirst: 'recordings',
    ...input,
  })
}

describe('chooseRowSource', () => {
  it('lets a valid recording pin win over playFirst', () => {
    expect(
      choose({
        pin: { recordingId: 'r2', linkId: null },
        recordings: [rec('r1'), rec('r2')],
        links: [link('l1', 'apple_music')],
        playFirst: 'apple_music',
      }),
    ).toEqual({ kind: 'recording', id: 'r2' })
  })

  it('lets a valid link pin win over playFirst', () => {
    expect(
      choose({
        pin: { recordingId: null, linkId: 'l2' },
        recordings: [rec('r1')],
        links: [link('l1', 'apple_music'), link('l2', 'youtube')],
      }),
    ).toEqual({ kind: 'link', id: 'l2' })
  })

  it('ignores a pin to a deleted row', () => {
    expect(
      choose({
        pin: { recordingId: 'r2', linkId: null },
        recordings: [rec('r1'), rec('r2', { deleted_at: '2026-01-01T00:00:00Z' })],
      }),
    ).toEqual({ kind: 'recording', id: 'r1' })
  })

  it('ignores a pin to a row of another tune', () => {
    expect(
      choose({
        pin: { recordingId: 'r2', linkId: null },
        recordings: [rec('r1'), rec('r2', { tune_id: 'other' })],
      }),
    ).toEqual({ kind: 'recording', id: 'r1' })
  })

  it('ignores a link pin to a deleted link', () => {
    expect(
      choose({
        pin: { recordingId: null, linkId: 'l2' },
        recordings: [rec('r1')],
        links: [
          link('l1', 'youtube'),
          link('l2', 'youtube', { deleted_at: '2026-01-01T00:00:00Z' }),
        ],
      }),
    ).toEqual({ kind: 'recording', id: 'r1' })
  })

  it("ignores a link pin to another tune's link", () => {
    expect(
      choose({
        pin: { recordingId: null, linkId: 'l2' },
        links: [link('l1', 'youtube'), link('l2', 'apple_music', { tune_id: 'other' })],
      }),
    ).toEqual({ kind: 'link', id: 'l1' })
  })

  it('falls through from a pin to a deleted recording to a valid link', () => {
    expect(
      choose({
        pin: { recordingId: 'r1', linkId: null },
        recordings: [rec('r1', { deleted_at: '2026-01-01T00:00:00Z' })],
        links: [link('l1', 'youtube')],
      }),
    ).toEqual({ kind: 'link', id: 'l1' })
  })

  it('ignores a pin to an id not in the inputs', () => {
    expect(
      choose({ pin: { recordingId: 'gone', linkId: 'gone' }, recordings: [rec('r1')] }),
    ).toEqual({ kind: 'recording', id: 'r1' })
  })

  it.each<PlayFirst>(['recordings', 'apple_music'])(
    'returns the one source whatever playFirst is (%s)',
    (playFirst) => {
      expect(choose({ recordings: [rec('r1')], playFirst })).toEqual({
        kind: 'recording',
        id: 'r1',
      })
      expect(choose({ links: [link('l1', 'youtube')], playFirst })).toEqual({
        kind: 'link',
        id: 'l1',
      })
    },
  )

  it('picks the first recording when playFirst is recordings', () => {
    expect(
      choose({
        recordings: [rec('r1'), rec('r2')],
        links: [link('l1', 'apple_music')],
        playFirst: 'recordings',
      }),
    ).toEqual({ kind: 'recording', id: 'r1' })
  })

  it('picks the first Apple Music link when playFirst is apple_music', () => {
    expect(
      choose({
        recordings: [rec('r1')],
        links: [link('l1', 'youtube'), link('l2', 'apple_music'), link('l3', 'apple_music')],
        playFirst: 'apple_music',
      }),
    ).toEqual({ kind: 'link', id: 'l2' })
  })

  it('falls back to the first recording when apple_music has no Apple Music link', () => {
    expect(
      choose({
        recordings: [rec('r1')],
        links: [link('l1', 'youtube')],
        playFirst: 'apple_music',
      }),
    ).toEqual({ kind: 'recording', id: 'r1' })
  })

  it('picks an Apple Music link listed after another link when there are no recordings', () => {
    expect(
      choose({
        links: [link('l1', 'youtube'), link('l2', 'apple_music')],
        playFirst: 'recordings',
      }),
    ).toEqual({ kind: 'link', id: 'l2' })
  })

  it('picks the first link when there are only links and none is Apple Music', () => {
    expect(
      choose({ links: [link('l1', 'youtube'), link('l2', 'spotify')], playFirst: 'apple_music' }),
    ).toEqual({ kind: 'link', id: 'l1' })
  })

  it('never counts deleted rows', () => {
    const deleted = { deleted_at: '2026-01-01T00:00:00Z' }
    expect(
      choose({
        recordings: [rec('r1', deleted), rec('r2')],
        links: [link('l1', 'apple_music', deleted), link('l2', 'youtube')],
        playFirst: 'apple_music',
      }),
    ).toEqual({ kind: 'recording', id: 'r2' })
    expect(
      choose({
        recordings: [rec('r1', deleted)],
        links: [link('l1', 'youtube', deleted)],
      }),
    ).toBeNull()
  })

  it('returns null when there is nothing to play', () => {
    expect(choose({})).toBeNull()
  })
})
