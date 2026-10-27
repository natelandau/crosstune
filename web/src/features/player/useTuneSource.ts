import { useLiveQuery } from 'dexie-react-hooks'
import { useAuthSession } from '../../auth/AuthContext'
import { recordingsPlayable } from '../../billing/plan'
import { usePlanOrUnknown } from '../../billing/usePlan'
import { settingsId } from '../../commands/settings'
import { useDb } from '../../db/DbProvider'
import { storedPlayFirst } from '../../db/types'
import { useOnline } from '../../sync/SyncProvider'
import { playableMedia, readTuneMedia, sourceFor, type RowSource } from '../lists/useListRowSource'

/**
 * What a tune's Play plays: null when it has nothing, undefined while it is being read. Only
 * what can play or open now counts, so a pin or the Play first order passes over a recording
 * with no audio here and none the player can fetch. The recording `loadedRecordingId` names
 * always counts, so its Stop stays while it plays.
 */
export function useTuneSource(
  tuneId: string,
  loadedRecordingId: string | null = null,
): RowSource | null | undefined {
  const db = useDb()
  const { userId } = useAuthSession()
  const recordingsPlay = recordingsPlayable(usePlanOrUnknown())
  const online = useOnline()
  const read = useLiveQuery(async () => {
    const [media, userTunes, settings] = await Promise.all([
      readTuneMedia(db, [tuneId]),
      db.user_tunes.where('tune_id').equals(tuneId).toArray(),
      db.user_settings.get(settingsId(userId)),
    ])
    return {
      userTune: userTunes.find((row) => !row.deleted_at),
      media: media.get(tuneId) ?? { views: [], links: [] },
      settings,
    }
  }, [db, userId, tuneId])
  if (!read) return undefined
  const { userTune, media, settings } = read
  return sourceFor({
    tuneId,
    pin: {
      recordingId: userTune?.play_recording_id ?? null,
      linkId: userTune?.play_link_id ?? null,
    },
    media: playableMedia(media, { online, loadedRecordingId }),
    playFirst: storedPlayFirst(settings),
    recordingsPlay,
  })
}
