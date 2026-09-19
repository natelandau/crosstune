import { IonProgressBar } from '@ionic/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useDb } from '../../db/DbProvider'
import { getStorage } from '../../db/meta'
import { formatBytes } from '../recording/format'

/** How much of the account's audio quota is spent, once the server has said what it is. */
export function Storage() {
  const db = useDb()
  const figures = useLiveQuery(() => getStorage(db), [db])
  if (!figures || figures.quota_bytes <= 0) return null
  const used = Math.min(1, figures.used_bytes / figures.quota_bytes)
  return (
    <div className="px-5 py-2">
      <p className="type-footnote tabular-nums">
        {formatBytes(figures.used_bytes)} of {formatBytes(figures.quota_bytes)} used
      </p>
      <IonProgressBar aria-label="Storage used" value={used} className="mt-1.5" />
    </div>
  )
}
