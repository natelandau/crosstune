import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonModal,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/react'
import * as Sentry from '@sentry/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Contrast, ImageOff, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { useDb } from '../../db/DbProvider'
import type { ScanFile } from '../../db/scans'
import type { LocalScan } from '../../db/types'
import { useWakeLock } from '../../platform/wakeLock'
import { DELETE } from '../../ui/Confirm'
import { useDialogName } from '../../ui/dialogName'
import { InlineError } from '../../ui/InlineError'
import { useLatest } from '../../ui/useLatest'
import { CLOSE } from '../links/linkNames'
import {
  deleteScanName,
  downloadingScanName,
  INVERT,
  SCANS,
  SCAN_WAITING,
  SCAN_UNREADABLE,
  scanCount,
  scanName,
  ZOOM,
} from './scanCopy'
import { aspectRatio, useScanImage } from './scanImages'
import type { ScanViewOrigin } from './scanViewLog'
import { useDeleteScan } from './useDeleteScan'
import { useInvert } from './useInvert'
import { useScans } from './useScans'
import { useScanViewLog } from './useScanViewLog'

const ZOOM_FACTOR = 2
// Two taps closer together than this, in time and in distance, are one double tap.
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_PX = 30

interface Tap {
  at: number
  x: number
  y: number
}

/**
 * A tune's scans at full screen, one at a time, for reading at a jam: swipe or scroll between
 * them, double-tap or Zoom for twice the fitted size, Invert for light ink on dark paper. The
 * screen stays awake while it is open, and each look at the scans is logged under `origin`.
 * Mounted to open and unmounted from `onClose`, once its dismissal has finished.
 */
export function ScanViewer({
  tuneId,
  startIndex,
  origin,
  onClose,
  now = Date.now,
}: {
  tuneId: string
  startIndex: number
  origin: ScanViewOrigin
  onClose: () => void
  /** The clock views are timed on. */
  now?: () => number
}) {
  const db = useDb()
  const endView = useScanViewLog(db, tuneId, origin, now)
  const data = useScans(tuneId)
  const tuneTitle = useLiveQuery(async () => (await db.tunes.get(tuneId))?.title, [db, tuneId])
  const [invert, setInvert] = useInvert()
  const [open, setOpen] = useState(true)
  const [index, setIndex] = useState(startIndex)
  const [zoom, setZoom] = useState<{ index: number; width: number } | null>(null)
  const pager = useRef<HTMLDivElement | null>(null)
  // The pager mounts only once the modal presents its contents, so its arrival is state the
  // placing effect can wait on.
  const [pagerShown, setPagerShown] = useState(false)
  const reported = useRef(new Set<string>())
  const attachPager = useCallback((element: HTMLDivElement | null) => {
    pager.current = element
    setPagerShown(element !== null)
  }, [])
  const { error, remove } = useDeleteScan()
  const modal = useRef<HTMLIonModalElement>(null)
  const placed = useRef(false)
  const presenting = useRef(false)
  const onCloseRef = useLatest(onClose)
  const lastTap = useRef<Tap | null>(null)
  const name = tuneTitle ? `${tuneTitle} ${SCANS.toLowerCase()}` : SCANS
  useDialogName(modal, name)
  useWakeLock(true)

  const scans = data?.scans ?? []
  const shown = Math.min(index, Math.max(0, scans.length - 1))
  const shownRef = useLatest(shown)
  // Nothing renders until the invert setting is read, so an inverted scan never flashes white.
  const ready = data !== undefined && invert !== undefined
  const empty = data !== undefined && data.scans.length === 0

  // A modal that never presented never dismisses, so a tune with no scans left before it
  // opened has to say it is done itself.
  useEffect(() => {
    if (empty && !presenting.current) onCloseRef.current()
  }, [empty, onCloseRef])

  // The pager has no width until the modal lays it out, so the opening scan is scrolled to on
  // the first size it reports, and the scan on screen is kept on screen through a later resize.
  useEffect(() => {
    const element = pager.current
    if (!pagerShown || !element) return
    const place = () => {
      if (element.clientWidth === 0) return
      const target = placed.current ? shownRef.current : startIndex
      placed.current = true
      element.scrollLeft = target * element.clientWidth
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(element)
    return () => observer.disconnect()
  }, [pagerShown, startIndex, shownRef])

  // A zoomed scan opens on its middle, where a fitted scan's center was.
  useLayoutEffect(() => {
    if (!zoom) return
    const slide = pager.current?.querySelector<HTMLElement>(`[data-scan-index="${zoom.index}"]`)
    if (!slide) return
    slide.scrollLeft = (slide.scrollWidth - slide.clientWidth) / 2
    slide.scrollTop = (slide.scrollHeight - slide.clientHeight) / 2
  }, [zoom])

  const toggleZoom = (at: number) => {
    if (zoom) {
      setZoom(null)
      return
    }
    const image = pager.current?.querySelector<HTMLImageElement>(`[data-scan-index="${at}"] img`)
    if (!image) return
    setZoom({ index: at, width: image.getBoundingClientRect().width * ZOOM_FACTOR })
  }

  // Counted from pointerup's own timestamps, so a swipe (which the browser cancels into a
  // scroll) never reads as a tap, and no gesture library is needed for the one gesture.
  const onPointerUp = (event: PointerEvent, at: number) => {
    const previous = lastTap.current
    const tap = { at: event.timeStamp, x: event.clientX, y: event.clientY }
    if (
      previous &&
      tap.at - previous.at < DOUBLE_TAP_MS &&
      Math.hypot(tap.x - previous.x, tap.y - previous.y) < DOUBLE_TAP_PX
    ) {
      lastTap.current = null
      toggleZoom(at)
      return
    }
    lastTap.current = tap
  }

  // Once per scan while the viewer is open, since a scan decodes again each time it comes
  // back into reach.
  const reportBroken = (scanId: string) => {
    if (reported.current.has(scanId)) return
    reported.current.add(scanId)
    Sentry.captureMessage('scans: scan image could not be decoded', {
      level: 'warning',
      extra: { scanId },
    })
  }

  return (
    <IonModal
      ref={modal}
      // A tune whose last scan is deleted has nothing left to show.
      isOpen={open && scans.length > 0}
      aria-label={name}
      onWillPresent={() => {
        presenting.current = true
      }}
      onWillDismiss={endView}
      onDidDismiss={onClose}
      className="scan-modal"
    >
      <IonHeader>
        <IonToolbar className="scan-toolbar">
          <IonTitle className="tabular-nums">
            {scans.length > 0 ? scanCount(shown, scans.length) : ''}
          </IonTitle>
          <IonButtons slot="end">
            <IonButton
              className="toolbar-control"
              aria-label={ZOOM}
              // A string, since Ionic's wrapper drops a boolean aria-* prop.
              aria-pressed={zoom ? 'true' : 'false'}
              onClick={() => toggleZoom(shown)}
            >
              {zoom ? (
                <ZoomOut aria-hidden="true" className="size-6" />
              ) : (
                <ZoomIn aria-hidden="true" className="size-6" />
              )}
            </IonButton>
            <IonButton
              className="toolbar-control"
              aria-label={INVERT}
              aria-pressed={invert ? 'true' : 'false'}
              onClick={() => void setInvert(!invert)}
            >
              <Contrast aria-hidden="true" className="size-6" />
            </IonButton>
            <IonButton
              className="toolbar-control"
              aria-label={CLOSE}
              onClick={() => setOpen(false)}
            >
              <X aria-hidden="true" className="size-6" />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent scrollY={false}>
        <div className="flex h-full flex-col">
          {error ? <InlineError className="px-(--form-gutter) py-2">{error}</InlineError> : null}
          {ready ? (
            <div
              ref={attachPager}
              data-pager
              role="region"
              aria-label={name}
              // Focusable so the arrow keys scroll it from one scan to the next.
              tabIndex={0}
              className={`flex min-h-0 flex-1 touch-manipulation snap-x snap-mandatory overflow-y-hidden ${zoom ? 'overflow-x-hidden' : 'overflow-x-auto'}`}
              onScroll={(event) => {
                const element = event.currentTarget
                if (!placed.current || element.clientWidth === 0) return
                setIndex(Math.round(element.scrollLeft / element.clientWidth))
              }}
            >
              {scans.map((scan, at) => (
                <div
                  key={scan.id}
                  data-scan-index={at}
                  className={`flex h-full w-full shrink-0 snap-center ${zoom?.index === at ? 'overflow-auto' : 'overflow-hidden'}`}
                  onPointerUp={(event) => onPointerUp(event, at)}
                >
                  <Slide
                    scan={scan}
                    file={data.files.get(scan.id)}
                    index={at}
                    // Only the scans beside the one shown draw their image, so twenty full
                    // scans never sit decoded in memory at once.
                    near={Math.abs(at - shown) <= 1}
                    invert={invert}
                    zoomWidth={zoom?.index === at ? zoom.width : null}
                    onBroken={() => reportBroken(scan.id)}
                    onDelete={() => remove(scan, data.files.get(scan.id))}
                  />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </IonContent>
    </IonModal>
  )
}

function Slide({
  scan,
  file,
  index,
  near,
  invert,
  zoomWidth,
  onBroken,
  onDelete,
}: {
  scan: LocalScan
  file: ScanFile | undefined
  index: number
  near: boolean
  invert: boolean
  zoomWidth: number | null
  onBroken: () => void
  onDelete: () => void
}) {
  const image = useScanImage(file, { enabled: near, onBroken })
  if (image.kind === 'broken') {
    return (
      <div className="m-auto flex flex-col items-center gap-3 px-8 text-center">
        <ImageOff aria-hidden="true" className="size-12 text-(--ion-color-medium)" />
        <p className="type-headline m-0">{SCAN_UNREADABLE}</p>
        <IonButton
          color="danger"
          fill="outline"
          aria-label={deleteScanName(index)}
          onClick={onDelete}
        >
          {DELETE}
        </IonButton>
      </div>
    )
  }
  if (!file) {
    return (
      <div
        data-scan-placeholder
        className="m-auto grid max-h-full w-[min(100%,40rem)] place-items-center bg-(--ion-background-color-step-100)"
        style={{ aspectRatio: aspectRatio(scan) }}
      >
        {scan.state === 'ready' ? (
          <div role="status" aria-label={downloadingScanName(index)}>
            <IonSpinner aria-hidden="true" />
          </div>
        ) : (
          <p className="type-footnote m-0 px-4 text-center">{SCAN_WAITING}</p>
        )}
      </div>
    )
  }
  // A scan out of reach keeps its URL but not its pixels: only an img on screen holds those.
  if (image.kind === 'loading' || !near) return null
  return (
    <img
      src={image.url}
      alt={scanName(index)}
      draggable={false}
      className={`m-auto object-contain ${zoomWidth === null ? 'max-h-full max-w-full' : 'max-w-none'} ${invert ? 'invert' : ''}`}
      style={zoomWidth === null ? undefined : { width: zoomWidth, height: 'auto' }}
    />
  )
}
