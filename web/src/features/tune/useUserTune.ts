import { useLiveQuery } from 'dexie-react-hooks'
import { useDb } from '../../db/DbProvider'
import { readUserTune } from '../../db/tunes'
import type { LocalUserTune } from '../../db/types'

/** The live user tune of `tuneId`, undefined while it reads, for no tune, or once it is gone. */
export function useUserTune(tuneId: string | null): LocalUserTune | undefined {
  const db = useDb()
  return useLiveQuery(
    async () => (tuneId === null ? undefined : readUserTune(db, tuneId)),
    [db, tuneId],
  )
}
