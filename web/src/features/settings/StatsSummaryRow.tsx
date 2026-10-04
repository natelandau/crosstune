import { IonItem, IonLabel, useIonRouter } from '@ionic/react'
import { useState } from 'react'
import { useDb } from '../../db/DbProvider'
import { Group } from '../../ui/Group'
import { summaryLine } from '../stats/copy'
import { useStats } from '../stats/useStats'

/**
 * The first row of Settings: the catalog in one line, opening the stats page. It reads no
 * history, so opening Settings never starts the events pull.
 */
export function StatsSummaryRow() {
  const db = useDb()
  const router = useIonRouter()
  const [now] = useState(() => new Date())
  const view = useStats(db, now, { history: false })
  // Until the rows are read, an empty row holds the place so the groups below never shift.
  if (!view)
    return (
      <Group>
        {/* Its own key, so the real row mounts fresh: Ionic copies aria-hidden into an item
            once and never takes it back. */}
        <IonItem key="placeholder" aria-hidden="true">
          <IonLabel>{'\u00a0'}</IonLabel>
        </IonItem>
      </Group>
    )
  const { counts, recorded } = view.stats
  return (
    <Group>
      <IonItem button detail onClick={() => router.push('/settings/stats', 'forward', 'push')}>
        <IonLabel className="whitespace-normal tabular-nums">
          {summaryLine({
            tunes: counts.tunes,
            lists: counts.lists,
            recordings: counts.recordings,
            scans: counts.scans,
            ms: recorded.total_ms,
          })}
        </IonLabel>
      </IonItem>
    </Group>
  )
}
