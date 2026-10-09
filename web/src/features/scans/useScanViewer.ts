import * as Sentry from '@sentry/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { useAnalytics } from '../../analytics/AnalyticsProvider'
import { useDb } from '../../db/DbProvider'
import type { ScanFile } from '../../db/scans'
import type { LocalScan } from '../../db/types'
import { useWakeLock } from '../../platform/wakeLock'
import type { ConfirmQuestion } from '../../ui/confirmQuestion'
import { useLatest } from '../../ui/useLatest'
import { SCANS, scanViewerName } from './scanCopy'
import type { ScanViewOrigin } from './scanViewLog'
import { useDeleteScan } from './useDeleteScan'
import { useInvert } from './useInvert'
import { useScans } from './useScans'
import { useScanViewLog } from './useScanViewLog'

// Two taps closer together than this, in time and in distance, are one double tap.
export const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_PX = 30

const NO_SCANS: LocalScan[] = []
const NO_FILES = new Map<string, ScanFile>()

interface Tap {
  at: number
  x: number
  y: number
}

export interface ScanViewer {
  /** The viewer's accessible name: the tune's title with "scans", or "Scans" until it is read. */
  name: string
  scans: LocalScan[]
  files: Map<string, ScanFile>
  /** The scan the viewer opened on, where a pager first places itself. */
  startIndex: number
  /** The scan shown, kept within the scans that remain. */
  index: number
  setIndex: (index: number) => void
  count: number
  /** True once the scans and the invert setting are read, so an inverted scan never flashes
   * white. */
  ready: boolean
  invert: boolean
  setInvert: (on: boolean) => void
  zoom: 'fit' | 2
  toggleZoom: () => void
  /** Whether this tap finishes a double tap; a tap that does starts no new pair. */
  isDoubleTap: (event: { clientX: number; clientY: number }) => boolean
  /** Reports a scan that could not be decoded, once per scan while the viewer is mounted. */
  reportBroken: (scanId: string) => void
  /** Deletes the scan at `at`, the one shown by default, once the musician confirms. */
  remove: (at?: number) => void
  error: string | null
  /** Ends the view and hands off to `onClose`. */
  close: () => void
}

/**
 * A tune's scans one at a time, for reading at a jam: which is shown, zoom, invert, and the
 * double tap that zooms. The screen stays awake while it is mounted, and each look at the scans
 * is logged under `origin`. Once the last scan is deleted it closes
 * itself. Placing the pager and centering a zoomed scan are the component's.
 */
export function useScanViewer({
  tuneId,
  startIndex,
  origin,
  now = Date.now,
  confirm,
  onClose,
}: {
  tuneId: string
  startIndex: number
  origin: ScanViewOrigin
  /** The clock views and taps are timed on. */
  now?: () => number
  confirm: (question: ConfirmQuestion) => Promise<boolean>
  onClose: () => void
}): ScanViewer {
  const db = useDb()
  const analytics = useAnalytics()
  const data = useScans(tuneId)
  const empty = data !== undefined && data.scans.length === 0
  // A view runs only while there are scans, so a pager that stays mounted through an empty
  // tune starts a fresh one when sync brings scans back.
  const endView = useScanViewLog(db, tuneId, origin, now, !empty)
  const tuneTitle = useLiveQuery(async () => (await db.tunes.get(tuneId))?.title, [db, tuneId])
  const [invert, setInvert] = useInvert()
  const [index, setIndex] = useState(startIndex)
  const [zoom, setZoom] = useState<'fit' | 2>('fit')
  const { error, remove } = useDeleteScan({ confirm })
  const reported = useRef(new Set<string>())
  const lastTap = useRef<Tap | null>(null)
  useWakeLock(true)

  const scans = data?.scans ?? NO_SCANS
  const files = data?.files ?? NO_FILES
  const shown = Math.min(index, Math.max(0, scans.length - 1))

  // Reported once per opening, when scans are first on screen: scans that sync in while the
  // viewer is open count, and a page turn does not report again. This runs ahead of the view
  // log's threshold, which only decides what is stored.
  const viewedRef = useRef(false)
  const hasScans = scans.length > 0
  useEffect(() => {
    if (!hasScans || viewedRef.current) return
    viewedRef.current = true
    analytics.send('scan_viewed', { tune_id: tuneId })
  }, [hasScans, tuneId, analytics])

  const close = () => {
    endView()
    onClose()
  }
  const closeRef = useLatest(close)

  // A tune whose last scan is deleted has nothing left to show.
  useEffect(() => {
    if (empty) closeRef.current()
  }, [empty, closeRef])

  return {
    name: tuneTitle ? scanViewerName(tuneTitle) : SCANS,
    scans,
    files,
    startIndex,
    index: shown,
    setIndex,
    count: scans.length,
    ready: data !== undefined && invert !== undefined,
    invert: invert ?? false,
    setInvert: (on) => void setInvert(on),
    zoom,
    toggleZoom: () => setZoom((current) => (current === 'fit' ? 2 : 'fit')),
    // A swipe the browser cancels into a scroll ends in pointercancel, never pointerup, so no
    // gesture library is needed. Taps are timed on the injected clock so tests can drive them.
    isDoubleTap: ({ clientX, clientY }) => {
      const previous = lastTap.current
      const tap = { at: now(), x: clientX, y: clientY }
      if (
        previous &&
        tap.at - previous.at < DOUBLE_TAP_MS &&
        Math.hypot(tap.x - previous.x, tap.y - previous.y) < DOUBLE_TAP_PX
      ) {
        lastTap.current = null
        return true
      }
      lastTap.current = tap
      return false
    },
    // Once per scan, since a scan decodes again each time it comes back into reach.
    reportBroken: (scanId) => {
      if (reported.current.has(scanId)) return
      reported.current.add(scanId)
      Sentry.captureMessage('scans: scan image could not be decoded', {
        level: 'warning',
        extra: { scanId },
      })
    },
    remove: (at = shown) => {
      const scan = scans[at]
      if (scan) remove(scan, files.get(scan.id))
    },
    error,
    close,
  }
}
