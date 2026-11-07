import { useLiveQuery } from 'dexie-react-hooks'
import { useDb } from '../../db/DbProvider'
import { liveTune } from '../../db/tunes'
import type { LocalTune } from '../../db/types'

/** The live tune `tuneId`: null for no tune or one gone, undefined while it reads. */
export function useLiveTune(tuneId: string | null): LocalTune | null | undefined {
  const db = useDb()
  return useLiveQuery(
    async () => (tuneId === null ? null : liveTune(await db.tunes.get(tuneId))),
    [db, tuneId],
  )
}
