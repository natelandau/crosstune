import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { useAnalytics } from '../../../usage/AnalyticsProvider'
import { failureReason } from '../../../usage/failure'
import { useAuthSession } from '../../../auth/AuthContext'
import { useDb } from '../../../db/DbProvider'
import { useAction } from '../../../ui/useAction'
import { EXPORT_COMPLETE_NOTE, exportMissingNote, exportProgress } from './exportCopy'
import { createExport, downloadBlob, exportCounts } from './runExport'

export interface ExportData {
  /** What the export holds, read only while open; undefined until read. */
  counts: Awaited<ReturnType<typeof exportCounts>> | undefined
  /** Files prepared so far while an export runs, or null before the first. */
  progress: { done: number; total: number; label: string } | null
  /** What the export will hold, or null until the counts are read. */
  note: string | null
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
 * Zips the tunes, lists, and every recording and scan this device holds into one download.
 * Reopening resets the last run's progress and error; unmounting abandons a run.
 */
export function useExportData(open: boolean): ExportData {
  const db = useDb()
  const { userId } = useAuthSession()
  const analytics = useAnalytics()
  const { error, pending, runThen, clear } = useAction()
  const [closing, setClosing] = useState(false)
  const [openedFor, setOpenedFor] = useState(open)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const controller = useRef<AbortController | null>(null)
  const counts = useLiveQuery(() => (open ? exportCounts(db) : undefined), [db, open])

  if (open !== openedFor) {
    setOpenedFor(open)
    if (open) {
      setClosing(false)
      setProgress(null)
      clear()
    }
  }

  useEffect(() => () => controller.current?.abort(), [])

  const abandon = () => controller.current?.abort()

  const run = () => {
    if (controller.current) return
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
    ? counts.onDevice < counts.total
      ? exportMissingNote(counts.onDevice, counts.total)
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
