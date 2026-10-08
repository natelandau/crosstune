import { useLiveQuery } from 'dexie-react-hooks'
import type { PlayFirst } from '../../api/vocabulary'
import { activeLinksForTune } from '../../commands/links'
import { useDb } from '../../db/DbProvider'
import type { LocalRecordingLink } from '../../db/types'
import { chooseRowSource } from '../player/tuneSource'
import { useRecordingsWithFiles, type RecordingView } from '../recordings/useRecordings'
import type { ListItemView } from './useLists'

export type RowSource =
  { kind: 'recording'; view: RecordingView } | { kind: 'link'; link: LocalRecordingLink }

/**
 * What a list row plays for its tune: `null` when it has nothing, `undefined` until its media
 * has been read. Reads the tune's own media in tune-screen order, because a row's view carries
 * none.
 */
export function useListRowSource(
  entry: ListItemView,
  playFirst: PlayFirst | undefined,
): RowSource | null | undefined {
  const db = useDb()
  const tuneId = entry.tune.id
  const views = useRecordingsWithFiles({ tuneId })
  const links = useLiveQuery(() => activeLinksForTune(db, tuneId), [db, tuneId])
  if (!views || !links || playFirst === undefined) return undefined
  const chosen = chooseRowSource({
    tuneId,
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
