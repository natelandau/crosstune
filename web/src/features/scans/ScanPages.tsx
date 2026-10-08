import { ChevronLeft, ChevronRight, ImageOff, LoaderCircle, ZoomIn, ZoomOut } from 'lucide-react'
import { useReducedMotionConfig } from 'motion/react'
import type { ReactNode } from 'react'
import type { ScanFile } from '../../db/scans'
import type { LocalScan } from '../../db/types'
import {
  downloadingScanName,
  NEXT_SCAN,
  PREVIOUS_SCAN,
  SCAN_UNREADABLE,
  SCAN_WAITING,
  scanName,
  ZOOM,
} from './scanCopy'
import { aspectRatio, useScanImage } from './scanImages'
import { useScanPager } from './useScanPager'
import type { ScanViewer } from './useScanViewer'
import { Button } from '../../ui/Button'

/**
 * A tune's scans side by side, one to a page: swipe, scroll, or the arrow keys page between
 * them, as do Previous scan and Next scan in the bar under them, and a double tap or Zoom
 * shows the scan at twice its fitted size. It fills its container and holds no way out, which
 * the viewer around it supplies. `brokenAction` is what a scan that cannot be shown offers.
 */
export function ScanPages({
  viewer,
  brokenAction,
}: {
  viewer: ScanViewer
  brokenAction: (index: number) => ReactNode
}) {
  const reduceMotion = useReducedMotionConfig() ?? false
  const { scans, files, index: shown, invert } = viewer
  const { attachPager, zoomed, toggleZoom, go, onScroll } = useScanPager(viewer, {
    reduceMotion,
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={attachPager}
        data-pager
        role="region"
        aria-label={scanName(shown)}
        // Focusable so the arrow keys scroll it from one scan to the next. The ring sits inside,
        // since the pager meets the window's edges.
        tabIndex={0}
        className={`flex min-h-0 flex-1 touch-manipulation snap-x snap-mandatory overflow-y-hidden focus-visible:-outline-offset-4! ${zoomed ? 'overflow-x-hidden' : 'overflow-x-auto'}`}
        onScroll={onScroll}
      >
        {scans.map((scan, at) => (
          <div
            key={scan.id}
            data-scan-index={at}
            className={`flex h-full w-full shrink-0 snap-center ${zoomed?.index === at ? 'overflow-auto' : 'overflow-hidden'}`}
            onPointerUp={(event) => {
              if (viewer.isDoubleTap(event)) toggleZoom(at)
            }}
          >
            <Slide
              scan={scan}
              file={files.get(scan.id)}
              index={at}
              // Only the scans beside the one shown draw their image, so twenty full scans
              // never sit decoded in memory at once.
              near={Math.abs(at - shown) <= 1}
              invert={invert}
              zoomWidth={zoomed?.index === at ? zoomed.width : null}
              onBroken={() => viewer.reportBroken(scan.id)}
              brokenAction={brokenAction(at)}
            />
          </div>
        ))}
      </div>
      <div
        data-scan-controls
        className="flex shrink-0 items-center justify-center gap-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
      >
        <Button
          icon={ChevronLeft}
          label={PREVIOUS_SCAN}
          iconOnly
          // aria-disabled rather than disabled: a disabled control cannot hold focus, so a
          // keyboard reaching the first scan would be dropped to the document.
          aria-disabled={shown === 0}
          onPress={() => go(shown - 1)}
        />
        <Button
          icon={zoomed ? ZoomOut : ZoomIn}
          label={ZOOM}
          iconOnly
          aria-pressed={zoomed !== null}
          onPress={() => toggleZoom(shown)}
        />
        <Button
          icon={ChevronRight}
          label={NEXT_SCAN}
          iconOnly
          aria-disabled={shown === scans.length - 1}
          onPress={() => go(shown + 1)}
        />
      </div>
    </div>
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
  brokenAction,
}: {
  scan: LocalScan
  file: ScanFile | undefined
  index: number
  near: boolean
  invert: boolean
  zoomWidth: number | null
  onBroken: () => void
  brokenAction: ReactNode
}) {
  const image = useScanImage(file, { enabled: near, onBroken })
  if (image.kind === 'broken') {
    return (
      <div className="m-auto flex flex-col items-center gap-3 px-8 text-center">
        <ImageOff aria-hidden className="text-ink-2 size-12" />
        <p className="t-heading">{SCAN_UNREADABLE}</p>
        {brokenAction}
      </div>
    )
  }
  if (!file) {
    return (
      <div
        data-scan-placeholder
        className="bg-fill m-auto grid max-h-full w-[min(100%,40rem)] place-items-center"
        style={{ aspectRatio: aspectRatio(scan) }}
      >
        {scan.state === 'ready' ? (
          <div role="status" aria-label={downloadingScanName(index)}>
            <LoaderCircle
              aria-hidden
              className="text-ink-2 size-6 animate-spin motion-reduce:animate-none"
            />
          </div>
        ) : (
          <p className="t-secondary text-ink-2 px-4 text-center">{SCAN_WAITING}</p>
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
