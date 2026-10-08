import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ScanViewOrigin } from './scanViewLog'
import { ScanViewer } from './ScanViewer'

/**
 * One scan viewer for a screen of tune rows, opened by a row's Scans action at the tune's first
 * scan and logged under `origin`. It lives on the screen rather than in each row, so no overlay
 * sits inside a list's collection of rows.
 */
export function useRowScanViewer(origin: ScanViewOrigin): {
  open: (tuneId: string) => void
  viewer: ReactNode
} {
  const [tuneId, setTuneId] = useState<string | null>(null)
  const [closed, setClosed] = useState(0)
  // The control that opened the viewer, which focus returns to, and the row it sits in.
  const opener = useRef<{ control: Element; row: HTMLElement | null } | null>(null)

  // Once the tune's last scan is gone its Scans control goes with it, so focus returns to the
  // row instead of falling to the page. Run after the commit that removes the viewer, so its
  // own focus restore finds the row already focused and leaves it.
  useEffect(() => {
    const from = opener.current
    opener.current = null
    if (from && !from.control.isConnected && from.row?.isConnected) from.row.focus()
  }, [closed])

  return {
    open: (id) => {
      const control = document.activeElement
      opener.current = control
        ? { control, row: control.closest<HTMLElement>('[role="row"]') }
        : null
      setTuneId(id)
    },
    viewer: (
      <ScanViewer
        tuneId={tuneId ?? ''}
        startIndex={0}
        origin={origin}
        isOpen={tuneId !== null}
        onOpenChange={(open) => {
          if (!open) setTuneId(null)
        }}
        onClosed={() => setClosed((count) => count + 1)}
      />
    ),
  }
}
