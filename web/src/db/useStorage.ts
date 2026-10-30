import { useLiveQuery } from 'dexie-react-hooks'
import { useDb } from './DbProvider'
import { getStorage, type StorageUsage } from './meta'

/** The server's last storage report: undefined until the store is read, then null until the
 * server has sent one. */
export function useStorage(): StorageUsage | null | undefined {
  const db = useDb()
  return useLiveQuery(() => getStorage(db), [db])
}
