import { useCallback, useEffect, useLayoutEffect, useRef, useState, type UIEvent } from 'react'
import { useLatest } from '../../ui/useLatest'
import type { ScanViewer } from './useScanViewer'

export interface ScanPager {
  /** Takes the scrolling element that holds one page per scan, each `[data-scan-index]`. */
  attachPager: (element: HTMLDivElement | null) => void
  /** The zoomed scan and its zoomed width, or null while every scan fits. */
  zoomed: { index: number; width: number } | null
  /** Zooms the scan at `at` to twice its fitted width, or back to fit. */
  toggleZoom: (at: number) => void
  /** Scrolls to the scan at `to`, back at its fitted size. */
  go: (to: number) => void
  /** The pager's scroll handler, which keeps the viewer's index on the scan in view. */
  onScroll: (event: UIEvent<HTMLDivElement>) => void
}

/**
 * The geometry of a sideways pager of scans: it opens on the viewer's `startIndex` once the
 * pager has a width, keeps the scan in view through a resize, measures a scan's fitted width to
 * zoom it, and opens a zoomed scan on its middle.
 */
export function useScanPager(
  viewer: ScanViewer,
  { reduceMotion = false }: { reduceMotion?: boolean } = {},
): ScanPager {
  const { startIndex, index: shown, zoom, scans } = viewer
  // Which scan was zoomed, and the width it had when fitted.
  const [fitted, setFitted] = useState<{ index: number; width: number } | null>(null)
  const zoomed =
    zoom === 'fit' || !fitted ? null : { index: fitted.index, width: fitted.width * zoom }
  const pager = useRef<HTMLDivElement | null>(null)
  // The pager can mount after the hook, behind an overlay's entrance, so its arrival is state
  // the placing effect waits on.
  const [pagerShown, setPagerShown] = useState(false)
  const attachPager = useCallback((element: HTMLDivElement | null) => {
    pager.current = element
    setPagerShown(element !== null)
  }, [])
  const placed = useRef(false)
  const shownRef = useLatest(shown)

  // The pager has no width until it is laid out, so the opening scan is scrolled to on the
  // first size it reports, and the scan on screen stays on screen through a later resize.
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
    if (zoom === 'fit' || !fitted) return
    const slide = pager.current?.querySelector<HTMLElement>(`[data-scan-index="${fitted.index}"]`)
    if (!slide) return
    slide.scrollLeft = (slide.scrollWidth - slide.clientWidth) / 2
    slide.scrollTop = (slide.scrollHeight - slide.clientHeight) / 2
  }, [zoom, fitted])

  const toggleZoom = (at: number) => {
    if (zoom === 'fit') {
      const image = pager.current?.querySelector<HTMLImageElement>(`[data-scan-index="${at}"] img`)
      if (!image) return
      setFitted({ index: at, width: image.getBoundingClientRect().width })
    }
    viewer.toggleZoom()
  }

  return {
    attachPager,
    zoomed,
    toggleZoom,
    go: (to) => {
      const element = pager.current
      if (!element || to < 0 || to >= scans.length) return
      // A zoomed pager cannot scroll sideways, so paging returns the scan to its fitted size.
      if (zoom !== 'fit') viewer.toggleZoom()
      element.scrollTo({
        left: to * element.clientWidth,
        behavior: reduceMotion ? 'instant' : 'smooth',
      })
    },
    onScroll: (event) => {
      const element = event.currentTarget
      if (!placed.current || element.clientWidth === 0) return
      viewer.setIndex(Math.round(element.scrollLeft / element.clientWidth))
    },
  }
}
