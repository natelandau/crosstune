import { lazy, Suspense } from 'react'

// The page loads on first open, so the launch chunk stays under the service worker's precache
// size limit. The outlet waits for the page's IonPage to mount before it transitions, so the
// fallback renders nothing and the leaving screen stays put meanwhile.
const StatsPage = lazy(() =>
  import('./StatsPage').then((module) => ({ default: module.StatsPage })),
)

export function StatsRoute() {
  return (
    <Suspense fallback={null}>
      <StatsPage />
    </Suspense>
  )
}
