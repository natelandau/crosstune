import { useState } from 'react'
import { useOnline } from '../../../sync/SyncProvider'
import { blockedCount, exportSheetContent } from './exportState'
import { exportReadiness } from './readiness'
import type { RecordingView } from '../useRecordings'
import type { RecordingExportSheetProps } from './RecordingExportSheet'
import type { ExportItem } from './runRecordingExport'
import {
  useRecordingExport,
  type RecordingExport,
  type RecordingExportOptions,
} from './useRecordingExport'

export interface RecordingExportWithSheet extends RecordingExport {
  /**
   * Ends any export in progress and opens the download sheet on `items`. It starts at once when
   * none is blocked, and otherwise waits for Continue.
   */
  download(items: readonly ExportItem[]): void
  /**
   * Opens the download sheet on `items` to show the failed export that already ran on them,
   * without starting another.
   */
  reveal(items: readonly ExportItem[]): void
  /**
   * Downloads one recording, through the sheet when this device cannot hand it over at once, so
   * the sheet fetches it or says why it cannot.
   */
  downloadOne(view: RecordingView): void
  /** A failure the sheet does not show, such as a share's. */
  error: string | null
  sheet: RecordingExportSheetProps
}

/**
 * Recordings' export with its download sheet. A single recording's download that must fetch the
 * audio runs in the sheet; a file held here downloads or shares at once.
 */
export function useRecordingExportSheet({
  onDone,
}: RecordingExportOptions = {}): RecordingExportWithSheet {
  const online = useOnline()
  // Readiness as the sheet opened, so what it says it skips stays skipped when the connection
  // changes. Empty while the sheet is closed.
  const [opened, setOpened] = useState<readonly ExportItem[]>([])
  const open = opened.length > 0
  const recordingExport = useRecordingExport({
    onDone: (leftOut) => {
      setOpened([])
      onDone?.(leftOut)
    },
  })

  // A share's failure or a share still open must not hold up a download.
  const download = (items: readonly ExportItem[]) => {
    recordingExport.cancel()
    setOpened(items)
    if (blockedCount(items) === 0) recordingExport.exportItems(items, 'download')
  }

  const reveal = (items: readonly ExportItem[]) => setOpened(items)

  const exportOne: RecordingExport['exportOne'] = (view, how) => {
    if (how !== 'download') {
      recordingExport.exportOne(view, how)
      return
    }
    if (open) return
    const readiness = exportReadiness(view, online)
    if (readiness.kind === 'fetch') {
      download([{ view, readiness }])
      return
    }
    recordingExport.cancel()
    recordingExport.exportOne(view, how)
  }

  const downloadOne = (view: RecordingView) => {
    const readiness = exportReadiness(view, online)
    if (readiness.kind === 'local') exportOne(view, 'download')
    else download([{ view, readiness }])
  }

  return {
    ...recordingExport,
    exportOne,
    download,
    reveal,
    downloadOne,
    error: open ? null : recordingExport.error,
    sheet: {
      open,
      ...exportSheetContent(recordingExport.state, opened),
      onStart: () => recordingExport.exportItems(opened, 'download'),
      onCancel: () => {
        recordingExport.cancel()
        setOpened([])
      },
    },
  }
}
