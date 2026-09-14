import { createRootRoute, Outlet } from '@tanstack/react-router'
import { AppBar } from '../components/AppBar'
import { Dock } from '../components/Dock'
import { PlayerDock } from '../features/player/PlayerDock'
import { PlayerProvider } from '../features/player/PlayerProvider'

export const Route = createRootRoute({
  component: () => (
    <PlayerProvider>
      <div className="bg-base-100 flex min-h-dvh flex-col">
        <AppBar />
        <main
          tabIndex={-1}
          className="flex-1 px-4 pt-3 pb-[calc(6rem+env(safe-area-inset-bottom))] outline-none"
        >
          <Outlet />
          <PlayerDock />
        </main>
        <Dock />
      </div>
    </PlayerProvider>
  ),
})
