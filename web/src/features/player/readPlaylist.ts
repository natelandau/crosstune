import { activeByPosition } from '../../commands/write'
import { getMeta } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalList, LocalRecording, LocalRecordingLink } from '../../db/types'
import { listShows, META_LIST_SHOW_ARCHIVED } from '../lists/useListShowArchived'
import { readListView, type ListItemView } from '../lists/useLists'
import type { Availability, PlaylistEntry } from './listSource'

/** Each tune's live recordings and links, by tune id. */
export interface TuneSources {
  recordings: ReadonlyMap<string, readonly LocalRecording[]>
  links: ReadonlyMap<string, readonly LocalRecordingLink[]>
}

export interface PlaylistMedia {
  recordings: ReadonlyMap<string, readonly LocalRecording[]>
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

/** What `playlist` can play with the network as `online` says, on a plan that plays
 * recordings when `recordingsPlay` is true. */
export function playlistAvailability(
  playlist: Playlist,
  online: boolean,
  recordingsPlay: boolean,
): Availability {
  return { online, hasAudio: (id) => playlist.held.has(id), recordingsPlay }
}

/**
 * Each tune's live recordings, in tune-screen order (own recordings first, each group by
 * position), from one query whatever the number of tunes. A tune with none is absent.
 */
export async function readTuneRecordings(
  db: CrosstuneDb,
  tuneIds: readonly string[],
): Promise<Map<string, LocalRecording[]>> {
  const rows = await db.recordings
    .where('tune_id')
    .anyOf([...new Set(tuneIds)])
    .toArray()
  const recordings = new Map<string, LocalRecording[]>()
  for (const [tuneId, group] of groupByTune(rows)) {
    // Array.sort is stable, so each group keeps its position order.
    const ordered = activeByPosition(group).sort(
      (a, b) => Number(a.origin !== 'own') - Number(b.origin !== 'own'),
    )
    recordings.set(tuneId, ordered)
  }
  return recordings
}

/**
 * Each tune's recordings, as `readTuneRecordings` orders them, and its links, from one query
 * per table whatever the number of tunes. A tune with neither is absent from both maps.
 */
export async function readTuneSources(
  db: CrosstuneDb,
  tuneIds: readonly string[],
): Promise<TuneSources> {
  const unique = [...new Set(tuneIds)]
  const [recordings, linkRows] = await Promise.all([
    readTuneRecordings(db, unique),
    db.recording_links.where('tune_id').anyOf(unique).toArray(),
  ])
  const links = new Map<string, LocalRecordingLink[]>()
  for (const [tuneId, rows] of groupByTune(linkRows)) links.set(tuneId, activeByPosition(rows))
  return { recordings, links }
}

/** A list's recordings, and which of them this device holds. */
export async function readPlaylistMedia(
  db: CrosstuneDb,
  tuneIds: readonly string[],
): Promise<PlaylistMedia> {
  const recordings = await readTuneRecordings(db, tuneIds)
  const live = [...recordings.values()].flat()
  const files = await db.recording_files.bulkGet(live.map((r) => r.id))
  const held = new Set(live.filter((_, i) => files[i]?.blob).map((r) => r.id))
  return { recordings, held }
}

function groupByTune<T extends { tune_id?: string | null }>(rows: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    if (!row.tune_id) continue
    const group = groups.get(row.tune_id)
    if (group) group.push(row)
    else groups.set(row.tune_id, [row])
  }
  return groups
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
  }))
}

/** What a list can play now, read fresh, or null when the list is gone. */
export async function readPlaylist(db: CrosstuneDb, listId: string): Promise<Playlist | null> {
  const view = await readListView(db, listId)
  if (!view) return null
  return (await playlistsOf(db, [view])).get(listId) ?? null
}

/** What each live list can play now, keyed by list id, from one read of every tune's sources. */
export async function readPlaylists(db: CrosstuneDb): Promise<Map<string, Playlist>> {
  const lists = await db.lists.toArray()
  const views = await Promise.all(
    lists.filter((list) => !list.deleted_at).map((list) => readListView(db, list.id)),
  )
  return playlistsOf(
    db,
    views.filter((view) => view !== null),
  )
}

async function playlistsOf(
  db: CrosstuneDb,
  views: readonly { list: LocalList; items: ListItemView[] }[],
): Promise<Map<string, Playlist>> {
  const showArchived = (await getMeta(db, META_LIST_SHOW_ARCHIVED, false)) === true
  const shown = views.map((view) => ({
    list: view.list,
    rows: view.items.filter((v) => listShows(v, showArchived)),
  }))
  const media = await readPlaylistMedia(
    db,
    shown.flatMap(({ rows }) => rows.map((v) => v.tune.id)),
  )
  return new Map(
    shown.map(({ list, rows }) => [
      list.id,
      { name: list.name, entries: playlistEntries(rows, media), held: media.held },
    ]),
  )
}
