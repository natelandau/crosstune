import { useLiveQuery } from 'dexie-react-hooks'
import type { PlayFirst } from '../../api/vocabulary'
import { recordingsPlayable } from '../../billing/plan'
import { usePlanOrUnknown } from '../../billing/usePlan'
import { waitingParentIds } from '../../commands/recordings'
import { useDb } from '../../db/DbProvider'
import { holdsSplitAudio } from '../../domain/recordingLimits'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalRecordingLink } from '../../db/types'
import { linkControl } from '../links/linkControl'
import { recordingPlaysNow } from '../player/listSource'
import { readTuneSources } from '../player/readPlaylist'
import { chooseRowSource } from '../player/tuneSource'
import type { RecordingView } from '../recordings/useRecordings'
import type { ListItemView } from './useLists'

export type RowSource =
  { kind: 'recording'; view: RecordingView } | { kind: 'link'; link: LocalRecordingLink }

interface TuneMedia {
  views: RecordingView[]
  links: LocalRecordingLink[]
}

/** Each tune's own media in tune-screen order, keyed by tune id, because a row's view carries none. */
export async function readTuneMedia(
  db: CrosstuneDb,
  tuneIds: readonly string[],
): Promise<ReadonlyMap<string, TuneMedia>> {
  const sources = await readTuneSources(db, tuneIds)
  const recordings = [...sources.recordings.values()].flat()
  const [files, tunes, waiting] = await Promise.all([
    db.recording_files.bulkGet(recordings.map((recording) => recording.id)),
    db.tunes.bulkGet([...tuneIds]),
    waitingParentIds(db),
  ])
  const fileOf = new Map(recordings.map((recording, i) => [recording.id, files[i]] as const))
  const media = new Map<string, TuneMedia>()
  for (const [i, tuneId] of tuneIds.entries()) {
    const tune = tunes[i]
    const live = tune && !tune.deleted_at ? tune : undefined
    const views = (sources.recordings.get(tuneId) ?? []).map((recording) => ({
      recording,
      file: fileOf.get(recording.id),
      tuneId: live?.id ?? null,
      tuneTitle: live?.title ?? null,
      holdsSplitAudio: holdsSplitAudio(recording, waiting),
    }))
    media.set(tuneId, { views, links: [...(sources.links.get(tuneId) ?? [])] })
  }
  return media
}

/**
 * The media a tune can play or open now, so a pin or the Play first order passes over the rest:
 * a recording with audio here, or a ready copy the player can fetch (online only), and a link
 * with a player or an address. The recording `loadedRecordingId` names always counts, so its
 * Stop stays while it plays.
 */
export function playableMedia(
  media: TuneMedia,
  { online, loadedRecordingId }: { online: boolean; loadedRecordingId: string | null },
): TuneMedia {
  return {
    views: media.views.filter(
      (view) =>
        view.recording.id === loadedRecordingId ||
        recordingPlaysNow(view.recording, Boolean(view.file?.blob), online),
    ),
    links: media.links.filter((link) => linkControl(link, false).control !== 'none'),
  }
}

/** What a tune plays: its pin, else the Play first order over its own media. */
export function sourceFor({
  tuneId,
  pin,
  media,
  playFirst,
  recordingsPlay,
}: {
  tuneId: string
  pin: { recordingId: string | null; linkId: string | null }
  media: TuneMedia
  playFirst: PlayFirst
  recordingsPlay: boolean
}): RowSource | null {
  const { views, links } = media
  const chosen = chooseRowSource({
    tuneId,
    pin,
    recordings: views.map((view) => view.recording),
    links,
    playFirst,
    recordingsPlay,
  })
  if (!chosen) return null
  if (chosen.kind === 'link') {
    const link = links.find((l) => l.id === chosen.id)
    return link ? { kind: 'link', link } : null
  }
  const view = views.find((v) => v.recording.id === chosen.id)
  return view ? { kind: 'recording', view } : null
}

/**
 * What each list row plays, keyed by list item: `null` for a row with nothing, and undefined
 * for the whole map until the rows' media has been read. `loadedRecordingId` names the
 * recording the player holds, which keeps its row's Stop. One live query serves every row, so
 * a write re-reads the list's media once rather than once per row.
 */
export function useListRowSources(
  rows: readonly ListItemView[],
  playFirst: PlayFirst | undefined,
  loadedRecordingId: string | null = null,
): ReadonlyMap<string, RowSource | null> | undefined {
  const db = useDb()
  const recordingsPlay = recordingsPlayable(usePlanOrUnknown())
  // Keyed by the set of tunes, since the caller builds its rows afresh each render and a
  // reorder changes nothing to read.
  const key = [...new Set(rows.map((row) => row.tune.id))].sort().join(' ')
  const media = useLiveQuery(() => readTuneMedia(db, key ? key.split(' ') : []), [db, key])
  if (!media || playFirst === undefined) return undefined
  const sources = new Map<string, RowSource | null>()
  for (const row of rows) {
    const tuneMedia = media.get(row.tune.id)
    // A row whose tune joined after the last read waits for the next one.
    if (tuneMedia) {
      const input = {
        tuneId: row.tune.id,
        pin: {
          recordingId: row.userTune.play_recording_id ?? null,
          linkId: row.userTune.play_link_id ?? null,
        },
        playFirst,
        recordingsPlay,
      }
      // Counted online, so a recording only the server holds keeps its Download, which says
      // Offline. A tune with nothing playable falls back to all its media, so its row keeps
      // an empty slot rather than reading as a tune with nothing.
      const playable = playableMedia(tuneMedia, { online: true, loadedRecordingId })
      sources.set(
        row.item.id,
        sourceFor({ ...input, media: playable }) ?? sourceFor({ ...input, media: tuneMedia }),
      )
    }
  }
  return sources
}
