import { matchPath, type Params } from 'react-router'
import { destination, destinationOf } from '../../layout/destinations'
import { listTunePath, tuneHomePath } from '../../layout/tuneHome'
import { SETTINGS_STATS_PATH, statsTunePath } from '../settings/settingsPaths'

const RECORDINGS = destination('recordings')

// The tune pages a recording's page can sit under, each matched with whatever follows it.
const TUNE_PAGES: [pattern: string, path: (params: Params) => string][] = [
  [`${destination('catalog').root}/:tuneId/*`, (p) => tuneHomePath(p.tuneId)],
  [
    `${destination('lists').root}/:listId/tunes/:tuneId/*`,
    (p) => listTunePath(p.listId ?? '', p.tuneId ?? ''),
  ],
  [`${SETTINGS_STATS_PATH}/tunes/:tuneId/*`, (p) => statsTunePath(p.tuneId ?? '')],
]

// Recordings shows a tune, but holds a recording's page in its own segment, not under the tune.
const RECORDINGS_TUNE_PAGE: (typeof TUNE_PAGES)[number] = [
  `${RECORDINGS.root}/:tuneId`,
  (p) => `${RECORDINGS.root}/${p.tuneId}`,
]

function tunePageIn(
  pages: typeof TUNE_PAGES,
  pathname: string,
  tuneId: string,
): string | undefined {
  for (const [pattern, path] of pages) {
    const match = matchPath(pattern, pathname)
    if (match?.params.tuneId === tuneId) return path(match.params)
  }
  return undefined
}

/** The tune page for `tuneId` in the tab `pathname` shows, else the tune in the catalog. */
export function tunePageFor(pathname: string, tuneId: string): string {
  return tunePageIn([...TUNE_PAGES, RECORDINGS_TUNE_PAGE], pathname, tuneId) ?? tuneHomePath(tuneId)
}

/**
 * Where a recording's page opens from `pathname`: under the tune page showing the recording's
 * own tune, else under its tune in the open list or the catalog, else in Recordings. Each keeps
 * the page in the tab it opened from where that tab can hold it.
 */
export function recordingPageParent(pathname: string, tuneId: string | null): string {
  if (tuneId === null) return RECORDINGS.root
  const shown = tunePageIn(TUNE_PAGES, pathname, tuneId)
  if (shown) return shown
  const list = matchPath(`${destination('lists').root}/:listId/*`, pathname)?.params.listId
  if (list) return listTunePath(list, tuneId)
  return destinationOf(pathname) === 'catalog' ? tuneHomePath(tuneId) : RECORDINGS.root
}
