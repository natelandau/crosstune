import { useAnalytics } from '../../usage/AnalyticsProvider'
import { deleteScan } from '../../commands/scans'
import { useDb } from '../../db/DbProvider'
import type { ScanFile } from '../../db/scans'
import type { LocalScan } from '../../db/types'
import { DELETE } from '../../ui/confirmCopy'
import type { ConfirmQuestion } from '../../ui/confirmQuestion'
import { useAction } from '../../ui/useAction'
import { untracked, type TrackWork } from '../../ui/useWorking'
import { DELETE_SYNCED_NOTE, DELETE_UNSYNCED_NOTE } from '../recordings/recordingRow'
import { DELETE_SCAN_TITLE } from './scanCopy'

/** Deletes a scan once the musician confirms, saying first whether it can come back. */
export function useDeleteScan({
  confirm,
}: {
  confirm: (question: ConfirmQuestion) => Promise<boolean>
}) {
  const db = useDb()
  const analytics = useAnalytics()
  const { error, attempt, clear } = useAction()

  /** Asks, then deletes, handing the delete to `track`. A failure shows in `error`. */
  const remove = async (
    scan: LocalScan,
    file: ScanFile | undefined,
    track: TrackWork = untracked,
  ) => {
    // A captured file is the only copy until it uploads.
    const unsynced = file?.origin === 'captured'
    const ok = await confirm({
      title: DELETE_SCAN_TITLE,
      message: unsynced ? DELETE_UNSYNCED_NOTE : DELETE_SYNCED_NOTE,
      action: DELETE,
    })
    if (!ok) return
    void track(
      attempt(
        () => deleteScan(db, scan.id),
        () => analytics.send('scan_deleted', { scan_id: scan.id, tune_id: scan.tune_id }),
      ),
    )
  }

  return {
    error,
    clear,
    remove,
  }
}
