import { useLiveQuery } from 'dexie-react-hooks'
import type { PlayFirst } from '../../api/vocabulary'
import { activeLinksForTune } from '../../commands/links'
import { useDb } from '../../db/DbProvider'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalRecordingLink } from '../../db/types'
import { chooseRowSource } from '../player/tuneSource'
import { readRecordingsWithFiles, type RecordingView } from '../recordings/useRecordings'
import type { ListItemView } from './useLists'

export type RowSource =
  { kind: 'recording'; view: RecordingView } | { kind: 'link'; link: LocalRecordingLink }

interface TuneMedia {
  views: RecordingView[]
  links: LocalRecordingLink[]
}

/** Each tune's own media in tune-screen order, keyed by tune id, because a row's view carries none. */
async function readTuneMedia(
  db: CrosstuneDb,
  tuneIds: readonly string[],
): Promise<ReadonlyMap<string, TuneMedia>> {
  const read = await Promise.all(
    tuneIds.map(async (tuneId) => {
      const [views, links] = await Promise.all([
        readRecordingsWithFiles(db, { tuneId }),
        activeLinksForTune(db, tuneId),
      ])
      return [tuneId, { views, links }] as const
    }),
  )
  return new Map(read)
}

function rowSource(entry: ListItemView, media: TuneMedia, playFirst: PlayFirst): RowSource | null {
  const { views, links } = media
  const chosen = chooseRowSource({
    tuneId: entry.tune.id,
    pin: {
      recordingId: entry.userTune.play_recording_id ?? null,
      linkId: entry.userTune.play_link_id ?? null,
    },
    recordings: views.map((view) => view.recording),
    links,
    playFirst,
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
 * for the whole map until the rows' media has been read. One live query serves every row, so
 * a write re-reads the list's media once rather than once per row.
 */
export function useListRowSources(
  rows: readonly ListItemView[],
  playFirst: PlayFirst | undefined,
): ReadonlyMap<string, RowSource | null> | undefined {
  const db = useDb()
  // Keyed by the set of tunes, since the caller builds its rows afresh each render and a
  // reorder changes nothing to read.
  const key = [...new Set(rows.map((row) => row.tune.id))].sort().join(' ')
  const media = useLiveQuery(() => readTuneMedia(db, key ? key.split(' ') : []), [db, key])
  if (!media || playFirst === undefined) return undefined
  const sources = new Map<string, RowSource | null>()
  for (const row of rows) {
    const tuneMedia = media.get(row.tune.id)
    // A row whose tune joined after the last read waits for the next one.
    if (tuneMedia) sources.set(row.item.id, rowSource(row, tuneMedia, playFirst))
  }
  return sources
}
