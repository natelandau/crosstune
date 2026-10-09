import { describe, expect, it } from 'vitest'
import type { EndedPlay } from '../features/player/playLog'
import { createPlaybackReporter, type PlayedRows } from './playbackReporter'
import { recordingAnalytics } from './testing'

const rows: PlayedRows = {
  recording: (id) =>
    Promise.resolve(
      id === 'rec-1'
        ? { tune_id: 'tune-1', source: 'upload' }
        : { tune_id: null, source: 'import' },
    ),
  link: () => Promise.resolve({ tune_id: 'tune-2', provider: 'youtube' }),
}

const PLAYLIST_PLAY: EndedPlay = {
  recordingId: 'rec-1',
  origin: {
    context: 'list',
    listId: 'list-1',
    report: { source: 'list', queue: 'playlist', trigger: 'auto_advance' },
  },
  listenedMs: 45_000,
  lengthMs: 45_000,
  endedBy: 'finished',
  systemControlled: true,
}

describe('createPlaybackReporter', () => {
  it('reports a recording play with its kind, tune, and list', async () => {
    const analytics = recordingAnalytics()
    await createPlaybackReporter(analytics, rows).ended(PLAYLIST_PLAY)
    expect(analytics.sends()).toEqual([
      {
        name: 'playback_ended',
        props: {
          source: 'list',
          queue: 'playlist',
          trigger: 'auto_advance',
          kind: 'imported',
          listened_bucket: '30s-2m',
          completed: true,
          ended_by: 'finished',
          system_controlled: true,
          tune_id: 'tune-1',
          recording_id: 'rec-1',
          list_id: 'list-1',
        },
      },
    ])
  })

  it('leaves out a missing tune and list, and treats a play with no attribution as the dock', async () => {
    const analytics = recordingAnalytics()
    await createPlaybackReporter(analytics, rows).ended({
      recordingId: 'rec-2',
      origin: { context: 'dock' },
      listenedMs: 2_000,
      lengthMs: 60_000,
      endedBy: 'skipped',
      systemControlled: false,
    })
    expect(analytics.sends()).toEqual([
      {
        name: 'playback_ended',
        props: {
          source: 'dock',
          queue: 'single',
          trigger: 'tap',
          kind: 'slippery_hill',
          listened_bucket: '<10s',
          completed: false,
          ended_by: 'skipped',
          system_controlled: false,
          recording_id: 'rec-2',
        },
      },
    ])
  })

  it('reports a link play with no listened or completed', async () => {
    const analytics = recordingAnalytics()
    await createPlaybackReporter(analytics, rows).linkEnded({
      linkId: 'link-1',
      origin: {
        context: 'list',
        listId: 'list-1',
        report: { source: 'list', queue: 'single', trigger: 'tap' },
      },
      endedBy: 'closed',
    })
    expect(analytics.sends()).toEqual([
      {
        name: 'playback_ended',
        props: {
          source: 'list',
          queue: 'single',
          trigger: 'tap',
          kind: 'link',
          service: 'youtube',
          ended_by: 'closed',
          system_controlled: false,
          tune_id: 'tune-2',
          link_id: 'link-1',
          list_id: 'list-1',
        },
      },
    ])
  })

  it('playlist_started maps repeat one to tune', () => {
    const analytics = recordingAnalytics()
    createPlaybackReporter(analytics, rows).playlistStarted({
      shuffle: true,
      repeat: 'one',
      count: 12,
      listId: 'list-1',
    })
    expect(analytics.sends()).toEqual([
      {
        name: 'playlist_started',
        props: { shuffle: true, repeat: 'tune', count_bucket: '10-49', list_id: 'list-1' },
      },
    ])
  })

  it('reports a practice visit from the dock', async () => {
    const analytics = recordingAnalytics()
    await createPlaybackReporter(analytics, rows).practiceEnded({
      recordingId: 'rec-1',
      durationMs: 150_000,
      usedLoops: true,
      usedSpeed: false,
      usedPitch: true,
    })
    expect(analytics.sends()).toEqual([
      {
        name: 'practice_ended',
        props: {
          source: 'dock',
          duration_bucket: '2-5m',
          used_loops: true,
          used_speed: false,
          used_pitch: true,
          kind: 'imported',
          recording_id: 'rec-1',
          tune_id: 'tune-1',
        },
      },
    ])
  })

  it('skips only the report when its read fails', async () => {
    const analytics = recordingAnalytics()
    const failing: PlayedRows = {
      recording: () => Promise.reject(new Error('closed')),
      link: () => Promise.reject(new Error('closed')),
    }
    const reporter = createPlaybackReporter(analytics, failing)
    await reporter.ended(PLAYLIST_PLAY)
    await reporter.linkEnded({ linkId: 'link-1', origin: { context: 'row' }, endedBy: 'skipped' })
    expect(analytics.sends()).toEqual([])
  })
})
