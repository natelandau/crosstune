import { matchPath } from 'react-router'
import type { Screen } from './events'

// The route strings of `app/routes.tsx` that name a screen. The tune routes end in `:tuneId`
// under four parents; every other screen has a single address.
const SCREEN_PATTERNS: [pattern: string, screen: Screen][] = [
  ['/catalog', 'catalog'],
  ['/catalog/:tuneId', 'tune'],
  ['/lists', 'lists'],
  ['/lists/:listId', 'list'],
  ['/lists/:listId/tunes/:tuneId', 'tune'],
  ['/recordings', 'recordings'],
  ['/recordings/:tuneId', 'tune'],
  ['/settings', 'settings'],
  ['/settings/stats', 'stats'],
  ['/settings/stats/tunes/:tuneId', 'tune'],
  ['/settings/:page', 'settings'],
]

/** The screen an address shows, or null for the not-found page, `/kit`, and redirect-only paths. */
export function screenFor(pathname: string, notFound: boolean): Screen | null {
  if (notFound) return null
  for (const [pattern, screen] of SCREEN_PATTERNS) {
    if (matchPath({ path: pattern, end: true }, pathname)) return screen
  }
  return null
}
