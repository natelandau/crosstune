import { useLiveQuery } from 'dexie-react-hooks'
import { useAuthSession } from '../../auth/AuthContext'
import { settingsId } from '../../commands/settings'
import { useDb } from '../../db/DbProvider'
import type { LocalUserSettings } from '../../db/types'

/** The signed-in user's settings row: null when there is none, undefined until it has been read. */
export function useSettingsRow(): LocalUserSettings | null | undefined {
  const db = useDb()
  const { userId } = useAuthSession()
  // A missing row resolves to null so that undefined means "still loading" only.
  return useLiveQuery(
    async () => (await db.user_settings.get(settingsId(userId))) ?? null,
    [db, userId],
  )
}
