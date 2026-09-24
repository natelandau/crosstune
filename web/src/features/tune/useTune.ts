import { useLiveQuery } from 'dexie-react-hooks'
import { activeByPosition } from '../../commands/write'
import { useDb } from '../../db/DbProvider'
import type { LocalRecordingLink, LocalTune, LocalUserTune } from '../../db/types'

export interface TuneView {
  tune: LocalTune
  userTune: LocalUserTune
  links: LocalRecordingLink[]
}

export function useTune(tuneId: string): TuneView | null | undefined {
  const db = useDb()
  return useLiveQuery(async (): Promise<TuneView | null> => {
    const tune = await db.tunes.get(tuneId)
    if (!tune || tune.deleted_at) return null
    const userTune = (await db.user_tunes.where('tune_id').equals(tuneId).toArray()).find(
      (u) => !u.deleted_at,
    )
    if (!userTune) return null
    const links = activeByPosition(
      await db.recording_links.where('tune_id').equals(tuneId).toArray(),
    )
    return { tune, userTune, links }
  }, [db, tuneId])
}
