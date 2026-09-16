import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback } from 'react'
import { useDb } from '../../db/DbProvider'
import { getMeta, setMeta } from '../../db/meta'

/** One setting for every list, kept apart from the catalog's filters so clearing those
 * leaves it alone. */
export const META_LIST_SHOW_ARCHIVED = 'list_show_archived'

/** Whether lists show archived songs, undefined until read. */
export function useListShowArchived(): [boolean | undefined, (show: boolean) => Promise<void>] {
  const db = useDb()
  const show = useLiveQuery(
    async () => (await getMeta(db, META_LIST_SHOW_ARCHIVED, false)) === true,
    [db],
  )
  const setShow = useCallback((next: boolean) => setMeta(db, META_LIST_SHOW_ARCHIVED, next), [db])
  return [show, setShow]
}
