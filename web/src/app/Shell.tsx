import { useState, type ReactNode } from 'react'
import { Outlet } from 'react-router'
import { useFrame } from '../platform/frame'
import { NowPlaying } from '../features/player/NowPlaying'
import { useShellSelecting } from '../features/selection/useScreenSelection'
import { NowPlayingProvider, NowPlayingSlot } from './NowPlayingSlot'
import { SelectionSlot } from './selectionSlot'
import { Sidebar } from './Sidebar'
import { TabBar } from './TabBar'

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
 * tree on every frame, so a resize never remounts the screen and loses its state. While a
 * screen selects, its selection bar takes the tab bar's place on the phone.
 */
function Frame({ children }: { children: ReactNode }) {
  const frame = useFrame()
  const phone = frame === 'phone'
  const selecting = useShellSelecting()
  const [slot, setSlot] = useState<HTMLDivElement | null>(null)
  return (
    // The whole frame, bars included, is what recedes behind a touch sheet.
    <SelectionSlot value={slot}>
      <div data-sheet-root className="bg-ground text-ink flex h-dvh">
        {!phone && <Sidebar />}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1 overflow-y-auto">{children}</div>
          <NowPlayingSlot />
          {phone && !selecting && <TabBar />}
          {phone && <div ref={setSlot} className="contents" />}
        </div>
      </div>
    </SelectionSlot>
  )
}
