import { useLiveQuery } from 'dexie-react-hooks'
import { useDb } from '../../db/DbProvider'
import { getStorage } from '../../db/meta'
import { formatBytes } from '../../text/format'

export interface StorageSummary {
  used: number
  quota: number
  /** How full the quota is, from 0 to 1. */
  fraction: number
  /** "250 MB of 1 GB used". */
  label: string
}

/** How much of the account's audio quota is spent; null until the server has said what it is. */
export function useStorageSummary(): StorageSummary | null {
  const db = useDb()
  const figures = useLiveQuery(() => getStorage(db), [db])
  if (!figures || figures.quota_bytes <= 0) return null
  const { used_bytes: used, quota_bytes: quota } = figures
  return {
    used,
    quota,
    fraction: Math.min(1, used / quota),
    label: `${formatBytes(used)} of ${formatBytes(quota)} used`,
  }
}
