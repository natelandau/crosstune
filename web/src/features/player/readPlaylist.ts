import { activeLinksForTune } from '../../commands/links'
import { getMeta } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalRecording, LocalRecordingLink } from '../../db/types'
import { listShows, META_LIST_SHOW_ARCHIVED } from '../lists/useListShowArchived'
import { readListView, type ListItemView } from '../lists/useLists'
import { readRecordingsWithFiles } from '../recordings/useRecordings'
import type { PlaylistEntry } from './listSource'

/** The sources of some tunes, keyed by tune id, and which recordings this device holds. */
export interface PlaylistMedia {
  recordings: ReadonlyMap<string, readonly LocalRecording[]>
  links: ReadonlyMap<string, readonly LocalRecordingLink[]>
  /** Recordings whose audio this device holds. */
  held: ReadonlySet<string>
}

export interface Playlist {
  name: string
  /** The tunes the list shows, in stored order. */
  entries: PlaylistEntry[]
  /** Recordings whose audio this device holds. */
  held: ReadonlySet<string>
}

/** Each tune's recordings, in tune-screen order, and its links. */
export async function readPlaylistMedia(
  db: CrosstuneDb,
  tuneIds: readonly string[],
): Promise<PlaylistMedia> {
  const unique = [...new Set(tuneIds)]
  const read = await Promise.all(
    unique.map(async (tuneId) => ({
      tuneId,
      views: await readRecordingsWithFiles(db, { tuneId }),
      links: await activeLinksForTune(db, tuneId),
    })),
  )
  const recordings = new Map<string, LocalRecording[]>()
  const links = new Map<string, LocalRecordingLink[]>()
  const held = new Set<string>()
  for (const { tuneId, views, links: tuneLinks } of read) {
    recordings.set(
      tuneId,
      views.map((v) => v.recording),
    )
    links.set(tuneId, tuneLinks)
    for (const { recording, file } of views) if (file?.blob) held.add(recording.id)
  }
  return { recordings, links, held }
}

/** One entry per row, in the rows' order, each with its user tune's pin. */
export function playlistEntries(
  rows: readonly ListItemView[],
  media: PlaylistMedia,
): PlaylistEntry[] {
  return rows.map(({ tune, userTune }) => ({
    tuneId: tune.id,
    pin: { recordingId: userTune.play_recording_id ?? null },
    recordings: media.recordings.get(tune.id) ?? [],
    links: media.links.get(tune.id) ?? [],
  }))
}

/** What a list can play now, read fresh, or null when the list is gone. */
export async function readPlaylist(db: CrosstuneDb, listId: string): Promise<Playlist | null> {
  const view = await readListView(db, listId)
  if (!view) return null
  const showArchived = (await getMeta(db, META_LIST_SHOW_ARCHIVED, false)) === true
  const shown = view.items.filter((v) => listShows(v, showArchived))
  const media = await readPlaylistMedia(
    db,
    shown.map((v) => v.tune.id),
  )
  return { name: view.list.name, entries: playlistEntries(shown, media), held: media.held }
}
