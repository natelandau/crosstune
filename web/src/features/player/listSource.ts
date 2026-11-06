import type { LocalRecording } from '../../db/types'
import { liveRows } from './tuneSource'
import type { PlayerItem } from '../../domain/playerItem'

export type PlaylistRecording = Pick<LocalRecording, 'id' | 'tune_id' | 'deleted_at' | 'state'>

/** One tune of a list with the sources a playing list chooses from. */
export interface PlaylistEntry {
  tuneId: string
  /** The user tune's pinned recording; a link pin never plays in a list. */
  pin: { recordingId: string | null }
  /** In the order the tune screen shows them. */
  recordings: readonly PlaylistRecording[]
}

/** Whether a recording's audio can play on this device now. */
export interface Availability {
  online: boolean
  /** True when this device holds the recording's audio. */
  hasAudio: (recordingId: string) => boolean
  /** False while the plan plays no recording. */
  recordingsPlay: boolean
}

export interface PlaylistReport {
  /** Tune ids in list order. */
  playable: string[]
  total: number
}

/** A recording plays now with its audio held here, or online once the server holds a copy to send. */
export function recordingPlaysNow(
  recording: { state: string },
  hasAudio: boolean,
  online: boolean,
): boolean {
  return hasAudio || (online && recording.state === 'ready')
}

/**
 * What a playing list plays for a tune, or null when it skips it. Only recordings play, since an
 * embedded link cannot report its end. A recording can play with its audio held here, or
 * online once the server holds a copy to send. A pin that cannot play here passes over to the
 * first recording that can. Only live rows of this tune count, so a pin to a deleted row or to
 * another tune's row never plays. While the plan plays no recording, nothing plays.
 */
export function playlistSource(input: PlaylistEntry & Availability): PlayerItem | null {
  const { tuneId, online, hasAudio, recordingsPlay } = input
  const recordings = liveRows(input.recordings, tuneId)
  if (!recordingsPlay) return null
  const playable = recordings.filter((r) => recordingPlaysNow(r, hasAudio(r.id), online))
  const chosen = playable.find((r) => r.id === input.pin.recordingId) ?? playable[0]
  return chosen ? { kind: 'recording', id: chosen.id } : null
}

/**
 * Sorts a list's tunes into those a playing list plays and those it skips.
 * `entries` are the rows the list shows, so an archived tune counts only while archived tunes
 * show.
 */
export function playlistReport(
  entries: readonly PlaylistEntry[],
  availability: Availability,
): PlaylistReport {
  const report: PlaylistReport = { playable: [], total: entries.length }
  for (const entry of entries) {
    if (playlistSource({ ...entry, ...availability })) report.playable.push(entry.tuneId)
  }
  return report
}
