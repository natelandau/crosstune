import { useEffect } from 'react'
import { Outlet, useLocation, useMatches } from 'react-router'
import { useAnalytics } from '../analytics/AnalyticsProvider'
import { screenFor } from '../analytics/screens'
import { useBackTrail } from './backTrail'
import { destinationOf, rememberLocation } from './destinations'
import { isNotFound } from './notFound'

/**
 * Root layout: records where each destination last was, so switching back returns there, and
 * what each history entry was pushed from, so a back link can tell history back from a push.
 */
export function DestinationTracker() {
  const { pathname, search } = useLocation()
  const notFound = useMatches().some((match) => isNotFound(match.handle))
  const analytics = useAnalytics()
  useBackTrail()
  // Pathname only, so a search or filter change is not a new screen view.
  useEffect(() => {
    const screen = screenFor(pathname, notFound)
    if (screen) analytics.screen(screen)
  }, [pathname, notFound, analytics])
  useEffect(() => {
    const destination = destinationOf(pathname)
    if (destination && !notFound) rememberLocation(destination, pathname + search)
  }, [pathname, search, notFound])
  return <Outlet />
}
