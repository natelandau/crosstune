import { matchPath } from 'react-router'
import type { Screen } from './events'

// The route strings of `app/routes.tsx` that name a screen. The tune routes end in `:tuneId`
// under four parents, and the recording routes in `:recordingId` under four; every other screen
// has a single address.
const SCREEN_PATTERNS: [pattern: string, screen: Screen][] = [
  ['/catalog', 'catalog'],
  ['/catalog/:tuneId', 'tune'],
  ['/catalog/:tuneId/recordings/:recordingId', 'recording'],
  ['/lists', 'lists'],
  ['/lists/:listId', 'list'],
  ['/lists/:listId/tunes/:tuneId', 'tune'],
  ['/lists/:listId/tunes/:tuneId/recordings/:recordingId', 'recording'],
  ['/recordings', 'recordings'],
  ['/recordings/recording/:recordingId', 'recording'],
  ['/recordings/:tuneId', 'tune'],
  ['/tuner', 'tuner'],
  ['/settings', 'settings'],
  ['/settings/stats', 'stats'],
  ['/settings/stats/tunes/:tuneId', 'tune'],
  ['/settings/stats/tunes/:tuneId/recordings/:recordingId', 'recording'],
  ['/settings/recordings/locations/:placeId', 'settings'],
  ['/settings/:page', 'settings'],
]

/** The screen an address shows, or null for the not-found page, `/gallery`, and redirect-only paths. */
export function screenFor(pathname: string, notFound: boolean): Screen | null {
  if (notFound) return null
  for (const [pattern, screen] of SCREEN_PATTERNS) {
    if (matchPath({ path: pattern, end: true }, pathname)) return screen
  }
  return null
}
