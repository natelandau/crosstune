import { AppData } from './AppData'
import { createAppRouter, type AppRouter } from './router'

let router: AppRouter | undefined

/**
 * The app behind the sign-in gate, on one browser router for the page's life. A browser router
 * runs its redirects as soon as it exists, so one made before sign-in would move the address
 * off the sign-up path before AuthGate reads it.
 */
export function SignedInApp() {
  router ??= createAppRouter()
  return <AppData router={router} />
}
