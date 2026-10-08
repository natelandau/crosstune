import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Outlet } from 'react-router'
import { useFrame } from '../platform/frame'
import { NowPlaying } from '../features/player/NowPlaying'
import { useShellSelecting } from '../features/selection/useScreenSelection'
import { NowPlayingProvider, NowPlayingSlot } from './NowPlayingSlot'
import { SelectionSlot } from './selectionSlot'
import { Sidebar } from './Sidebar'
import { TabBar } from './TabBar'
import { useElementSize } from '../ui/useElementSize'

const TOAST_GAP_PX = 8

/**
 * The frame around every destination: the tab bar under one pane on the phone, the sidebar
 * beside the content on split and wide. The route's content fills the main region.
 */
export function Shell({ children }: { children?: ReactNode }) {
  // One provider above both frames, so a resize keeps whatever is docked.
  return (
    <NowPlayingProvider>
      <NowPlaying />
      <Frame>{children ?? <Outlet />}</Frame>
    </NowPlayingProvider>
  )
}

/**
 * The sidebar and the tab bar come and go around the content, which keeps its place in the
 * tree on every frame, so a resize never remounts the screen and loses its state. On the phone
 * the tab bar and now playing float over the foot of the content, which runs to the bottom of
 * the screen and scrolls beneath them. Their height is `--float-clearance`, which the panes pad
 * their ends by so a last row can scroll clear. While a screen selects, its selection bar takes
 * the tab bar's place.
 */
function Frame({ children }: { children: ReactNode }) {
  const frame = useFrame()
  const phone = frame === 'phone'
  const selecting = useShellSelecting()
  const [slot, setSlot] = useState<HTMLDivElement | null>(null)
  const floatRef = useRef<HTMLDivElement>(null)
  const { height: floatHeight } = useElementSize(floatRef)
  // A toast with no now playing to rise above clears the floating bar instead.
  useLayoutEffect(() => {
    if (!phone || !floatHeight) return
    const root = document.documentElement.style
    root.setProperty('--shell-clearance', `${floatHeight + TOAST_GAP_PX}px`)
    return () => {
      root.removeProperty('--shell-clearance')
    }
  }, [phone, floatHeight])
  return (
    // The whole frame, bars included, is what recedes behind a touch sheet.
    <SelectionSlot value={slot}>
      <div
        data-sheet-root
        className="bg-ground text-ink flex h-dvh"
        style={phone ? ({ '--float-clearance': `${floatHeight}px` } as CSSProperties) : undefined}
      >
        {!phone && <Sidebar />}
        <div className="flex min-w-0 flex-1 flex-col">
          <div data-float-pane className="relative min-h-0 flex-1">
            <div data-shell-scroller className="relative h-full overflow-y-auto">
              {children}
            </div>
            {/* Always mounted, so its size is watched across frame changes. */}
            <div
              ref={floatRef}
              hidden={!phone}
              className={`pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-2 px-[21px] *:pointer-events-auto ${
                selecting ? 'pb-2' : 'pb-[max(21px,calc(env(safe-area-inset-bottom)-13px))]'
              }`}
            >
              {phone && <NowPlayingSlot floating />}
              {phone && !selecting && <TabBar />}
            </div>
          </div>
          {!phone && <NowPlayingSlot />}
          {phone && <div ref={setSlot} className="contents" />}
        </div>
      </div>
    </SelectionSlot>
  )
}
