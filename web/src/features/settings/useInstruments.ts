import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { useAuthSession } from '../../auth/AuthContext'
import { settingsId } from '../../commands/settings'
import { useDb } from '../../db/DbProvider'
import type { Instrument } from '../../db/types'
import { instrumentsFrom } from './instruments'

/** The instruments the user plays, or undefined until the settings row has been read. */
export function useInstruments(): ReadonlySet<Instrument> | undefined {
  const db = useDb()
  const { userId } = useAuthSession()
  // A missing row resolves to null so that undefined means "still loading" only.
  const row = useLiveQuery(
    async () => (await db.user_settings.get(settingsId(userId))) ?? null,
    [db, userId],
  )
  return useMemo(() => (row === undefined ? undefined : instrumentsFrom(row)), [row])
}
