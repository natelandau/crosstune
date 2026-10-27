import { STORAGE_USED } from './recordingsCopy'
import { useStorageSummary } from './useStorageSummary'

/** How much storage the account uses, once the server has said, with a meter against its quota
 * when the plan has one. */
export function StorageSummary() {
  const summary = useStorageSummary()
  if (!summary) return null
  const percent = summary.fraction === null ? null : Math.round(summary.fraction * 100)
  return (
    <div data-storage-summary className="px-4 pt-6 pb-4">
      <p className="t-secondary t-num text-secondary">{summary.label}</p>
      {percent !== null && (
        <div
          role="progressbar"
          aria-label={STORAGE_USED}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={summary.label}
          className="bg-field mt-2 h-1 overflow-hidden rounded-full"
        >
          <div className="bg-text-secondary h-full rounded-full" style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  )
}
