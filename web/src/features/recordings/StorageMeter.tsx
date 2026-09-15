import { useLiveQuery } from 'dexie-react-hooks'
import { useDb } from '../../db/DbProvider'
import { getStorage } from '../../db/meta'
import { formatBytes } from '../recording/format'

export function StorageMeter() {
  const db = useDb()
  const figures = useLiveQuery(() => getStorage(db), [db])
  if (!figures || figures.quota_bytes <= 0) return null
  const percent = Math.min(100, Math.round((figures.used_bytes / figures.quota_bytes) * 100))
  return (
    <div className="space-y-1">
      <p className="text-sm">
        {formatBytes(figures.used_bytes)} of {formatBytes(figures.quota_bytes)} used
      </p>
      <progress className="progress w-full" value={percent} max={100} aria-label="Storage used" />
    </div>
  )
}
