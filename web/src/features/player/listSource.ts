import type { LocalRecording, LocalRecordingLink } from '../../db/types'
import { liveRows } from './tuneSource'
import type { PlayerItem } from '../../domain/playerItem'

/** Why a playing list passes over a tune. */
export type SkipReason = 'nothing' | 'linksOnly' | 'notHere'

export type PlaylistRecording = Pick<LocalRecording, 'id' | 'tune_id' | 'deleted_at' | 'state'>
export type PlaylistLink = Pick<LocalRecordingLink, 'id' | 'tune_id' | 'deleted_at'>

/** One tune of a list with the sources a playing list chooses from. */
export interface PlaylistEntry {
  tuneId: string
  /** The user tune's pinned recording; a link pin never plays in a list. */
  pin: { recordingId: string | null }
  /** In the order the tune screen shows them. */
  recordings: readonly PlaylistRecording[]
  links: readonly PlaylistLink[]
}

/** Whether a recording's audio can play on this device now. */
export interface Availability {
  online: boolean
  /** True when this device holds the recording's audio. */
  hasAudio: (recordingId: string) => boolean
}

export type PlaylistChoice = { item: PlayerItem } | { skip: SkipReason }

export interface PlaylistReport {
  /** Tune ids in list order. */
  playable: string[]
  /** Tune ids per reason, in list order. */
  skipped: Record<SkipReason, string[]>
  total: number
}

/**
 * What a playing list plays for a tune, or why it skips it. Only recordings play, since an
 * embedded link cannot report its end. A recording can play with its audio held here, or
 * online once the server holds a copy to send. A pin that cannot play here passes over to the
 * first recording that can. Only live rows of this tune count, so a pin to a deleted row or to
 * another tune's row never plays.
 */
export function playlistSource(input: PlaylistEntry & Availability): PlaylistChoice {
  const { tuneId, online, hasAudio } = input
  const recordings = liveRows(input.recordings, tuneId)
  const playable = recordings.filter((r) => hasAudio(r.id) || (online && r.state === 'ready'))
  const chosen = playable.find((r) => r.id === input.pin.recordingId) ?? playable[0]
  if (chosen) return { item: { kind: 'recording', id: chosen.id } }
  if (recordings.length > 0) return { skip: 'notHere' }
  const hasLinks = liveRows(input.links, tuneId).length > 0
  return { skip: hasLinks ? 'linksOnly' : 'nothing' }
}

/**
 * Sorts a list's tunes into those a playing list plays and those it skips, by reason.
 * `entries` are the rows the list shows, so an archived tune counts only while archived tunes
 * show.
 */
export function playlistReport(
  entries: readonly PlaylistEntry[],
  availability: Availability,
): PlaylistReport {
  const report: PlaylistReport = {
    playable: [],
    skipped: { nothing: [], linksOnly: [], notHere: [] },
    total: entries.length,
  }
  for (const entry of entries) {
    const choice = playlistSource({ ...entry, ...availability })
    if ('item' in choice) report.playable.push(entry.tuneId)
    else report.skipped[choice.skip].push(entry.tuneId)
  }
  return report
}
