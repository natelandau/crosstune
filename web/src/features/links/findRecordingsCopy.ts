export const FIND_RECORDINGS = 'Find recordings'
export const SEARCH_FOR = 'Search for'
export const PLAY = 'Play'
export const LINK = 'Link'
export const LINKED = 'Linked'
export const SEARCHING = 'Searching…'
export const NO_RESULTS = 'No results'
export const SEARCH_NEEDS_CONNECTION = 'Search needs a connection'
export const SEARCH_FAILED = "Couldn't search. Try again."
export { BACK } from '../../ui/confirmCopy'
export const ADD_TO_RECORDINGS = 'Add to recordings'

/** Shown when the browser blocks the tab a service's search page opens in. */
export const allowPopups = (label: string) => `Allow pop-ups to open ${label}.`

/** A row for one service, and the tune menu's item when only one service is chosen. */
export const searchService = (label: string) => `Search ${label}`
export const searchOn = (label: string) => `Search on ${label}`
/** A service that is rate limiting the app or cannot be reached; both read the same to a musician. */
export const unavailableNow = (label: string) =>
  `${label} isn't available right now. Try again in a few minutes.`
/** A wait under a second still reads as one, since "0 seconds" invites an instant retry. */
export const tooManySearches = (seconds: number) => {
  const wait = Math.max(1, Math.ceil(seconds))
  return `Too many searches. Try again in ${wait} ${wait === 1 ? 'second' : 'seconds'}.`
}

/** Each result's controls are named after it, since every row carries the same two words. */
export const playResult = (title: string) => `${PLAY} ${title}`
export const linkResult = (title: string) => `${LINK} ${title}`
export const linkedResult = (title: string) => `${LINKED} ${title}`
