import { useLiveQuery } from 'dexie-react-hooks'
import { usePlan } from '../../billing/usePlan'
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

/**
 * How much of the account's quota is spent; null until the server has said what it is. The quota
 * comes from the plan when it is known, so it stays right offline after a plan lapses; the used
 * bytes come from the server's last figure.
 */
export function useStorageSummary(): StorageSummary | null {
  const db = useDb()
  const plan = usePlan()
  const figures = useLiveQuery(() => getStorage(db), [db])
  if (!figures) return null
  const used = figures.used_bytes
  const quota = plan.quotaBytes ?? figures.quota_bytes
  if (quota <= 0) return null
  return {
    used,
    quota,
    fraction: Math.min(1, used / quota),
    label: `${formatBytes(used)} of ${formatBytes(quota)} used`,
  }
}
