import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { useAnalytics } from '../../../usage/AnalyticsProvider'
import { failureReason } from '../../../usage/failure'
import { useAuthSession } from '../../../auth/AuthContext'
import { useDb } from '../../../db/DbProvider'
import { useOnline, useSyncEngine } from '../../../sync/SyncProvider'
import { useAction } from '../../../ui/useAction'
import { useResetOnChange } from '../../../ui/useResetOnChange'
import { EXPORT_COMPLETE_NOTE, exportNeedsConnection, exportProgress } from './exportCopy'
import { createExport, downloadBlob, exportCounts } from './runExport'

export interface ExportData {
  /** What the export holds, read only while open; undefined until read. */
  counts: Awaited<ReturnType<typeof exportCounts>> | undefined
  /** Files prepared so far while an export runs, or null before the first. */
  progress: { done: number; total: number; label: string } | null
  /** What the export will hold, or why it cannot run; null until the counts are read. */
  note: string | null
  /** Starts the export, unless offline with files this device does not hold. */
  run: () => void
  /** Stops an export in progress so it never downloads. */
  abandon: () => void
  error: string | null
  pending: boolean
  /** True once the sheet should close: after Cancel, or after the download starts. */
  closing: boolean
  /** Abandons any export in progress and closes. */
  close: () => void
}

/**
 * Zips the tunes, lists, and every recording and scan into one download, fetching each file
 * this device does not hold.
 * Reopening resets the last run's progress and error; unmounting abandons a run.
 */
export function useExportData(open: boolean): ExportData {
  const db = useDb()
  const { userId } = useAuthSession()
  const analytics = useAnalytics()
  const engine = useSyncEngine()
  const online = useOnline()
  const { error, pending, runThen, clear } = useAction()
  const [closing, setClosing] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const controller = useRef<AbortController | null>(null)
  const counts = useLiveQuery(() => (open ? exportCounts(db) : undefined), [db, open])

  useResetOnChange(open, () => {
    if (open) {
      setClosing(false)
      setProgress(null)
      clear()
    }
  })

  useEffect(() => () => controller.current?.abort(), [])

  const abandon = () => controller.current?.abort()

  const needsConnection = !online && (counts?.missing ?? 0) > 0

  const run = () => {
    if (controller.current || needsConnection) return
    const abort = new AbortController()
    controller.current = abort
    setProgress(null)
    let finished = false
    runThen(
      async () => {
        try {
          const { fileName, blob } = await createExport(db, userId, {
            now: new Date(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            fetchMissing: engine.fetchFile,
            signal: abort.signal,
            onProgress: (done, total) => {
              if (controller.current === abort) setProgress(total > 0 ? { done, total } : null)
            },
          })
          if (abort.signal.aborted) return
          downloadBlob(blob, fileName)
          finished = true
          analytics.send('export_completed', { format: 'zip' })
        } catch (cause) {
          if (abort.signal.aborted) return
          analytics.send('export_failed', { format: 'zip', failure_reason: failureReason(cause) })
          throw cause
        } finally {
          if (controller.current === abort) controller.current = null
        }
      },
      () => {
        if (finished) setClosing(true)
      },
    )
  }

  const note = counts
    ? needsConnection
      ? exportNeedsConnection(counts.missing)
      : EXPORT_COMPLETE_NOTE
    : null

  return {
    counts,
    progress:
      pending && progress
        ? { ...progress, label: exportProgress(progress.done, progress.total) }
        : null,
    note,
    run,
    abandon,
    error,
    pending,
    closing,
    close: () => {
      abandon()
      setClosing(true)
    },
  }
}
