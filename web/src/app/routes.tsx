import { replace, type RouteObject } from 'react-router'
import { tuneHomePath } from './tuneHome'
import { ListsLayout } from '../features/lists/ListsLayout'
import { RecordingsLayout } from '../features/recordings/RecordingsLayout'
import { SettingsLayout } from '../features/settings/SettingsLayout'
import { isSettingsPage } from '../features/settings/settingsPages'
import { StatsPage } from '../features/stats/StatsPage'
import { CatalogTune, ListTune, RecordingsTune, StatsTune } from '../features/tune/tuneRoutes'
import { CatalogLayout } from './CatalogLayout'
import { DestinationTracker } from './DestinationTracker'
import { NOT_FOUND } from './notFound'
import { NotFoundPage } from './NotFoundPage'
import { destination } from './destinations'

// Each redirect replaces its entry, so Back never lands on an address that sends it forward again.
const tuneHome: RouteObject['loader'] = ({ params }) => replace(tuneHomePath(params.tuneId))

const SETTINGS = destination('settings')

const knownSettingsPage: RouteObject['loader'] = ({ params }) =>
  isSettingsPage(params.page) ? null : replace(SETTINGS.root)

// A literal flag, so a production build drops the kit's import and never emits its chunk.
const KIT: RouteObject[] = import.meta.env.DEV
  ? [{ path: '/kit', lazy: async () => ({ Component: (await import('../kit/KitPage')).KitPage }) }]
  : []

/**
 * Tab-scoped like native stacks: a tune opened from a list stays in Lists and Back returns to the
 * list. `dev` adds the component kit, a design review page only a dev server builds or serves.
 */
export function appRoutes(dev: boolean): RouteObject[] {
  return [
    {
      element: <DestinationTracker />,
      children: [
        { path: '/', loader: () => replace(destination('catalog').root) },
        ...(dev ? KIT : []),
        {
          path: '/catalog',
          // No index route: at the root the outlet is empty, which is what shows the list alone.
          element: <CatalogLayout />,
          children: [{ path: ':tuneId', element: <CatalogTune /> }],
        },
        {
          path: '/lists',
          // The layout reads the list and the tune from the address; the outlet holds the tune.
          element: <ListsLayout />,
          children: [
            { index: true, element: null },
            { path: ':listId', element: null },
            { path: ':listId/tunes/:tuneId', element: <ListTune /> },
          ],
        },
        {
          path: '/recordings',
          // No index route: at the root the outlet is empty, which is what shows the list alone.
          element: <RecordingsLayout />,
          children: [{ path: ':tuneId', element: <RecordingsTune /> }],
        },
        {
          path: '/settings',
          // The layout reads the page from the address; the routes only admit the known ones.
          // Stats and a tune opened from it fill the detail through the outlet.
          element: <SettingsLayout />,
          children: [
            { index: true, element: null },
            { path: 'stats', element: <StatsPage /> },
            { path: 'stats/tunes/:tuneId', element: <StatsTune /> },
            { path: ':page', loader: knownSettingsPage, element: null },
          ],
        },
        { path: '/tunes/:tuneId', loader: tuneHome },
        { path: '*', element: <NotFoundPage />, handle: NOT_FOUND },
      ],
    },
  ]
}

export const routes = appRoutes(import.meta.env.DEV)
