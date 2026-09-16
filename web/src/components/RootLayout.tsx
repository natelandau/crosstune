import { Outlet, useRouterState } from '@tanstack/react-router'
import { PlayerDock } from '../features/player/PlayerDock'
import { PlayerProvider } from '../features/player/PlayerProvider'
import { SelectionChromeProvider } from '../features/selection/SelectionChromeProvider'
import { AppBar } from './AppBar'
import { Dock } from './Dock'
import { ToastProvider } from './Toast'

export function RootLayout() {
  // The recording screen owns the whole viewport: no dock to record over, no player
  // to fight the mic for attention, no bottom padding sized for chrome that isn't there.
  const fullScreen = useRouterState({ select: (s) => s.location.pathname === '/record' })
  return (
    <PlayerProvider>
      <ToastProvider>
        <SelectionChromeProvider>
          <div className="bg-base-100 flex min-h-dvh flex-col">
            <AppBar />
            <main
              tabIndex={-1}
              // One measure for every screen: about 70 characters of body text at the regular size.
              className={`mx-auto w-full max-w-(--measure) flex-1 px-4 pt-3 outline-none ${
                fullScreen ? '' : 'pb-[calc(6rem+env(safe-area-inset-bottom))]'
              }`}
            >
              <Outlet />
              {fullScreen ? null : <PlayerDock />}
            </main>
            {fullScreen ? null : <Dock />}
          </div>
        </SelectionChromeProvider>
      </ToastProvider>
    </PlayerProvider>
  )
}
