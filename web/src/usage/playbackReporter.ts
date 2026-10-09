import * as Sentry from '@sentry/react'
import type { CrosstuneDb } from '../db/schema'
import type { RepeatMode } from '../features/player/listQueue'
import {
  tappedFrom,
  type EndedPlay,
  type PlayAttribution,
  type PlayOrigin,
} from '../features/player/playLog'
import type { ClosedVisit } from '../features/practice/practiceLog'
import { countBucket, durationBucket, listenedBucket } from './buckets'
import type { AnalyticsClient } from './client'
import type { Kind, Repeat } from './events'
import { recordingOrigin } from './origin'
import { serviceOf } from './service'

/** The rows a report reads for what a played item is and its tune. */
export interface PlayedRows {
  recording: (id: string) => Promise<{ tune_id?: string | null; source: string } | undefined>
  link: (id: string) => Promise<{ tune_id?: string | null; provider: string } | undefined>
}

export function playedRows(db: CrosstuneDb): PlayedRows {
  return {
    recording: (id) => db.recordings.get(id),
    link: (id) => db.recording_links.get(id),
  }
}

export interface PlaybackReporter {
  ended: (ended: EndedPlay) => Promise<void>
  /** An embed gives no timing and no media session, so a link reports neither. */
  linkEnded: (link: {
    linkId: string
    origin: PlayOrigin
    endedBy: 'skipped' | 'closed'
  }) => Promise<void>
  playlistStarted: (start: {
    shuffle: boolean
    repeat: RepeatMode
    count: number
    listId: string
  }) => void
  practiceEnded: (visit: ClosedVisit) => Promise<void>
}

const REPEAT: Record<RepeatMode, Repeat> = { off: 'off', list: 'list', one: 'tune' }
// Whatever loads without naming where it came from is the dock's.
const UNNAMED = tappedFrom('dock')

/** The list a play reports under: only one a list started, not one a dock Play resumed after. */
function listOf(origin: PlayOrigin, report: PlayAttribution): { list_id?: string } {
  return report.source === 'list' && origin.listId ? { list_id: origin.listId } : {}
}

/** A recording without its row reads as a take, the commonest kind. */
function recordingKind(row: { source: string } | undefined): Kind {
  return row ? recordingOrigin(row) : 'recorded'
}

/**
 * Sends the playback and practice events, each after reading what the item is and its tune. A
 * failed read costs that report and nothing else.
 */
export function createPlaybackReporter(
  analytics: AnalyticsClient,
  rows: PlayedRows | null,
): PlaybackReporter {
  const read = async <T>(lookUp: () => Promise<T>): Promise<{ row: T } | null> => {
    try {
      return { row: await lookUp() }
    } catch (error) {
      Sentry.captureException(error)
      return null
    }
  }
  const recording = (id: string) => read(async () => rows?.recording(id))
  const link = (id: string) => read(async () => rows?.link(id))

  return {
    ended: async (ended) => {
      const found = await recording(ended.recordingId)
      if (!found) return
      const { origin } = ended
      const report = origin.report ?? UNNAMED
      const tuneId = found.row?.tune_id
      analytics.send('playback_ended', {
        ...report,
        kind: recordingKind(found.row),
        listened_bucket: listenedBucket(ended.listenedMs),
        completed: ended.endedBy === 'finished',
        ended_by: ended.endedBy,
        system_controlled: ended.systemControlled,
        ...(tuneId ? { tune_id: tuneId } : {}),
        recording_id: ended.recordingId,
        ...listOf(origin, report),
      })
    },
    linkEnded: async ({ linkId, origin, endedBy }) => {
      const found = await link(linkId)
      if (!found) return
      const report = origin.report ?? UNNAMED
      const tuneId = found.row?.tune_id
      analytics.send('playback_ended', {
        ...report,
        kind: 'link',
        service: serviceOf(found.row?.provider ?? 'other'),
        ended_by: endedBy,
        system_controlled: false,
        ...(tuneId ? { tune_id: tuneId } : {}),
        link_id: linkId,
        ...listOf(origin, report),
      })
    },
    playlistStarted: ({ shuffle, repeat, count, listId }) => {
      analytics.send('playlist_started', {
        shuffle,
        repeat: REPEAT[repeat],
        count_bucket: countBucket(count),
        list_id: listId,
      })
    },
    practiceEnded: async (visit) => {
      const found = await recording(visit.recordingId)
      if (!found) return
      const tuneId = found.row?.tune_id
      analytics.send('practice_ended', {
        source: 'dock',
        duration_bucket: durationBucket(visit.durationMs),
        used_loops: visit.usedLoops,
        used_speed: visit.usedSpeed,
        used_pitch: visit.usedPitch,
        kind: recordingKind(found.row),
        recording_id: visit.recordingId,
        ...(tuneId ? { tune_id: tuneId } : {}),
      })
    },
  }
}
