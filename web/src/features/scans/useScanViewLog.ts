import { useCallback, useEffect, useRef } from 'react'
import { recordEvent } from '../../commands/events'
import { newId } from '../../commands/write'
import type { CrosstuneDb } from '../../db/schema'
import { iso, onPageLeave } from '../player/activity'
import { ScanViewLog, type ScanViewOrigin, type ScanViewRecord } from './scanViewLog'

function recordScanView(db: CrosstuneDb, record: ScanViewRecord, createdAt: number) {
  return recordEvent(db, 'scan_views', {
    id: newId(),
    tune_id: record.tuneId,
    context: record.context,
    list_id: record.listId,
    started_at: iso(record.startedAt),
    viewed_ms: record.viewedMs,
    created_at: iso(createdAt),
  })
}

/**
 * Logs each look at `tuneId`'s scans while the viewer is mounted, timed only while the page is in
 * the foreground. Returns the call that ends the view once the musician closes the viewer;
 * unmounting ends it too.
 */
export function useScanViewLog(
  db: CrosstuneDb,
  tuneId: string,
  { context, listId }: ScanViewOrigin,
  now: () => number,
): () => void {
  const logRef = useRef<ScanViewLog | null>(null)

  useEffect(() => {
    const log = new ScanViewLog(now, (record) => {
      // A lost view is not worth interrupting the musician over.
      void recordScanView(db, record, now()).catch(() => {})
    })
    logRef.current = log
    log.start(tuneId, { context, listId })
    if (document.visibilityState === 'hidden') log.visible(false)

    const unsubscribeLeave = onPageLeave(() => log.visible(false))
    const onReturn = () => {
      if (document.visibilityState === 'visible') log.visible(true)
    }
    document.addEventListener('visibilitychange', onReturn)
    // A page restored from the back-forward cache may come back without a visibility change.
    window.addEventListener('pageshow', onReturn)
    return () => {
      unsubscribeLeave()
      document.removeEventListener('visibilitychange', onReturn)
      window.removeEventListener('pageshow', onReturn)
      log.end()
      logRef.current = null
    }
  }, [db, tuneId, context, listId, now])

  return useCallback(() => logRef.current?.end(), [])
}
