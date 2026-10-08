import { STORAGE_USED } from './recordingsCopy'
import { useStorageSummary } from './useStorageSummary'

/** How much of the account's audio quota is spent, once the server has said what it is. */
export function StorageSummary() {
  const summary = useStorageSummary()
  if (!summary) return null
  const percent = Math.round(summary.fraction * 100)
  return (
    <div data-storage-summary className="px-4 pt-6 pb-4">
      <p className="t-secondary t-num text-ink-2">{summary.label}</p>
      <div
        role="progressbar"
        aria-label={STORAGE_USED}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={summary.label}
        className="bg-fill mt-2 h-1 overflow-hidden rounded-full"
      >
        <div className="bg-slate h-full rounded-full" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
