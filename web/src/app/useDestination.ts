import { useCallback, useContext } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { AppRouterContext } from './appRouterContext'
import { DESTINATIONS, destinationOf, rememberedLocation, type Destination } from './destinations'

const ROOTS = Object.fromEntries(DESTINATIONS.map((d) => [d.id, d.root])) as Record<
  Destination,
  string
>

/**
 * The destination the current location belongs to, and the two ways to switch. `current` is
 * null for paths outside the four, such as `/kit`, where no destination reads as current.
 */
export function useDestination(): {
  current: Destination | null
  go: (to: Destination) => void
  root: (to: Destination) => void
} {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const router = useContext(AppRouterContext)
  const current = destinationOf(pathname)

  const root = useCallback((to: Destination) => void navigate(ROOTS[to]), [navigate])
  const go = useCallback(
    (to: Destination) => {
      // The router commits a navigation in a transition, so the screen can still show the old
      // destination after a tap. A second tap must answer to where the router is going, not to
      // the screen, or a double tap reopens the remembered page instead of the root. Reading the
      // router, rather than navigating with flushSync, keeps the page transition.
      const state = router?.state
      const latest = state ? (state.navigation.location ?? state.location).pathname : pathname
      const here = destinationOf(latest)
      void navigate(to === here ? ROOTS[to] : (rememberedLocation(to) ?? ROOTS[to]))
    },
    [router, pathname, navigate],
  )
  return { current, go, root }
}
