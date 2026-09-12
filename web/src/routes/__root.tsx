import { createRootRoute, Outlet } from '@tanstack/react-router'
import { AppBar } from '../components/AppBar'
import { Dock } from '../components/Dock'

export const Route = createRootRoute({
  component: () => (
    <div className="bg-base-100 flex min-h-dvh flex-col">
      <AppBar />
      <main className="flex-1 px-4 pt-3 pb-24">
        <Outlet />
      </main>
      <Dock />
    </div>
  ),
})
