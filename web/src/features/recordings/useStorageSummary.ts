import { useLiveQuery } from 'dexie-react-hooks'
import { usePlan } from '../../billing/usePlan'
import { useDb } from '../../db/DbProvider'
import { getStorage } from '../../db/meta'
import { formatBytes } from '../../text/format'

export interface StorageSummary {
  used: number
  /** Null on a plan with no quota, as free. */
  quota: number | null
  /** How full the quota is, from 0 to 1; null with no quota. */
  fraction: number | null
  /** "250 MB of 1 GB used", or "250 MB used" with no quota. */
  label: string
}

/**
 * How much storage the account uses, and how much of its quota that is; null until the server has
 * given a figure. The quota comes from the plan when it is known, so it stays right offline after
 * a plan lapses; free has none, as the server's quota of 0 says too. The used bytes come from the
 * server's last figure.
 */
export function useStorageSummary(): StorageSummary | null {
  const db = useDb()
  const plan = usePlan()
  const figures = useLiveQuery(() => getStorage(db), [db])
  if (!figures) return null
  const used = figures.used_bytes
  const quota = plan.kind === 'free' ? 0 : (plan.quotaBytes ?? figures.quota_bytes)
  if (quota <= 0) {
    return { used, quota: null, fraction: null, label: `${formatBytes(used)} used` }
  }
  return {
    used,
    quota,
    fraction: Math.min(1, used / quota),
    label: `${formatBytes(used)} of ${formatBytes(quota)} used`,
  }
}
