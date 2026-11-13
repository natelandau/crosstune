import { Download, Share } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useOnline, useSyncEngine } from '../../../sync/SyncProvider'
import type { MenuItem } from '../../../ui/menuTypes'
import { localTimeZone } from '../../../text/localDate'
import { useLatest } from '../../../ui/useLatest'
import { useAnalytics } from '../../../usage/AnalyticsProvider'
import { countBucket } from '../../../usage/buckets'
import type { RecordingExportMethod } from '../../../usage/events'
import { DOWNLOAD } from '../recordingNames'
import type { RecordingView } from '../useRecordings'
import { EXPORT_BLOCK_REASONS, SHARE } from './exportCopy'
import { failureState, IDLE, settledState, type ExportState } from './exportState'
import { exportReadiness } from './readiness'
import {
  canShareSelection,
  deliverDownload,
  deliverShare,
  gatherRecordings,
  shareFiles,
  type ExportItem,
  type ExportResult,
} from './runRecordingExport'

/** How the web delivers an export; saving to a folder is Apple's. */
export type ExportHow = Extract<RecordingExportMethod, 'download' | 'share'>

export interface RecordingExport {
  exportOne(view: RecordingView, how: ExportHow): void
  /** A share runs only when every recording is held here; otherwise it does nothing. */
  exportMany(views: readonly RecordingView[], how: ExportHow): void
  /** `exportMany` with each recording's readiness already decided. */
  exportItems(items: readonly ExportItem[], how: ExportHow): void
  state: ExportState
  /** The last export's failure, while `state` is failed. */
  error: string | null
  /** Stops an export in progress so it never delivers. */
  cancel(): void
}

export interface RecordingExportOptions {
  /** After an export is delivered, with how many recordings' fetches failed. */
  onDone?: (leftOut: number) => void
}

/**
 * Downloads or shares recordings: each one this device holds, and each ready one it does not,
 * fetched and never stored. One export runs at a time; unmounting abandons it.
 */
export function useRecordingExport({ onDone }: RecordingExportOptions = {}): RecordingExport {
  const engine = useSyncEngine()
  const online = useOnline()
  const analytics = useAnalytics()
  const [state, setState] = useState<ExportState>(IDLE)
  const controller = useRef<AbortController | null>(null)
  const onDoneRef = useLatest(onDone)

  // Clearing the controller also ends `current`, so a share that settles later reports nothing.
  useEffect(
    () => () => {
      controller.current?.abort()
      controller.current = null
    },
    [],
  )

  /** Runs one export; a newer export or a cancel makes `current` false. */
  const start = (work: (signal: AbortSignal, current: () => boolean) => Promise<void>) => {
    const abort = new AbortController()
    controller.current = abort
    const current = () => controller.current === abort
    void work(abort.signal, current)
      .catch((cause: unknown) => {
        if (current() && !abort.signal.aborted) setState(failureState(cause))
      })
      .finally(() => {
        if (current()) controller.current = null
      })
  }

  const finish = (
    how: ExportHow,
    { files, fetched, skipped }: { files: number; fetched: number; skipped: number },
    leftOut: number,
  ) => {
    analytics.send('recording_exported', {
      method: how,
      count_bucket: countBucket(files),
      fetched_bucket: countBucket(fetched),
      skipped_bucket: countBucket(skipped),
    })
    setState({ kind: 'done', leftOut })
    onDoneRef.current?.(leftOut)
  }

  const share = (files: ExportResult['files']) =>
    start(async (_signal, current) => {
      await deliverShare(files)
      // A cancel while the share sheet is open cannot recall the sheet, but it ends the export.
      if (current()) finish('share', { files: files.length, fetched: 0, skipped: 0 }, 0)
    })

  const download = (items: readonly ExportItem[], timeZone: string) =>
    start(async (signal, current) => {
      const result = await gatherRecordings(items, {
        fetchFile: (id, fetchSignal) => engine.fetchFile('recording', id, fetchSignal),
        timeZone,
        signal,
        onProgress: (done, total) => {
          if (current()) setState({ kind: 'preparing', done, total })
        },
      })
      const settled = settledState(result)
      if (settled.kind !== 'done') {
        if (current()) setState(settled)
        return
      }
      await deliverDownload(result.files, new Date(), timeZone, signal)
      if (current()) finish('download', { ...result, files: result.files.length }, settled.leftOut)
    })

  const exportItems = (items: readonly ExportItem[], how: ExportHow) => {
    if (controller.current) return
    const timeZone = localTimeZone()
    if (how === 'download') {
      download(items, timeZone)
      return
    }
    const files = shareFiles(items, timeZone)
    if (files) share(files)
  }

  const exportMany = (views: readonly RecordingView[], how: ExportHow) =>
    exportItems(
      views.map((view) => ({ view, readiness: exportReadiness(view, online) })),
      how,
    )

  return {
    exportOne: (view, how) => exportMany([view], how),
    exportMany,
    exportItems,
    state,
    error: state.kind === 'failed' ? state.message : null,
    cancel: () => {
      controller.current?.abort()
      controller.current = null
      setState(IDLE)
    },
  }
}

/**
 * A recording's Download, and its Share where the browser can share the file. Share needs the
 * person's tap to still be live when the sheet opens, so it shows only for audio held here.
 */
export function exportMenuItems(
  view: RecordingView,
  online: boolean,
  exportOne: RecordingExport['exportOne'],
): MenuItem[] {
  const readiness = exportReadiness(view, online)
  const items: MenuItem[] = [
    {
      label: DOWNLOAD,
      icon: Download,
      tone: 'neutral',
      disabled: readiness.kind === 'blocked' ? EXPORT_BLOCK_REASONS[readiness.reason] : undefined,
      onPress: () => exportOne(view, 'download'),
    },
  ]
  if (canShareSelection([{ view, readiness }], localTimeZone())) {
    items.push({
      label: SHARE,
      icon: Share,
      tone: 'neutral',
      onPress: () => exportOne(view, 'share'),
    })
  }
  return items
}
