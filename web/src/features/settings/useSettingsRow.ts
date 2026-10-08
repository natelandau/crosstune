import { useLiveQuery } from 'dexie-react-hooks'
import { useAuthSession } from '../../auth/AuthContext'
import { settingsId } from '../../commands/settings'
import { useDb } from '../../db/DbProvider'
import type { LocalUserSettings } from '../../db/types'

/** The signed-in user's settings row (always undefined while `enabled` is false): null when there is none, undefined until it has been read. */
export function useSettingsRow(enabled = true): LocalUserSettings | null | undefined {
  const db = useDb()
  const { userId } = useAuthSession()
  // A missing row resolves to null so that undefined means "still loading" only.
  return useLiveQuery(
    async () => (enabled ? ((await db.user_settings.get(settingsId(userId))) ?? null) : undefined),
    [db, userId, enabled],
  )
}
