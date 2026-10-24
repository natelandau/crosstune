import { useLiveQuery } from 'dexie-react-hooks'
import { useAuthSession } from '../../auth/AuthContext'
import { recordingsPlayable } from '../../billing/plan'
import { usePlanOrUnknown } from '../../billing/usePlan'
import { settingsId } from '../../commands/settings'
import { useDb } from '../../db/DbProvider'
import { storedPlayFirst } from '../../db/types'
import { readTuneMedia, sourceFor, type RowSource } from '../lists/useListRowSource'

/** What a tune's Play plays: null when it has nothing, undefined while it is being read. */
export function useTuneSource(tuneId: string): RowSource | null | undefined {
  const db = useDb()
  const { userId } = useAuthSession()
  const recordingsPlay = recordingsPlayable(usePlanOrUnknown())
  return useLiveQuery(async () => {
    const [media, userTunes, settings] = await Promise.all([
      readTuneMedia(db, [tuneId]),
      db.user_tunes.where('tune_id').equals(tuneId).toArray(),
      db.user_settings.get(settingsId(userId)),
    ])
    const userTune = userTunes.find((row) => !row.deleted_at)
    return sourceFor({
      tuneId,
      pin: {
        recordingId: userTune?.play_recording_id ?? null,
        linkId: userTune?.play_link_id ?? null,
      },
      media: media.get(tuneId) ?? { views: [], links: [] },
      playFirst: storedPlayFirst(settings),
      recordingsPlay,
    })
  }, [db, userId, tuneId, recordingsPlay])
}
