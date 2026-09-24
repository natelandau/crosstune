import { Navigate, Route } from 'react-router-dom'
import { CatalogPage } from '../features/catalog/CatalogPage'
import { ListPage } from '../features/lists/ListPage'
import { ListsPage } from '../features/lists/ListsPage'
import { RecordingsPage } from '../features/recordings/RecordingsPage'
import { SettingsPage } from '../features/settings/SettingsPage'
import { TuneScreen } from '../features/tune/TuneScreen'
import { TuneRedirect } from './TuneRedirect'

/**
 * Tab-scoped, the way native stacks work: a tune opened from a list stays in the Lists tab
 * and Back returns to the list. The tune page is one component mounted at every path that
 * shows a tune. An array, not a fragment, because the outlet reads its routes from its
 * direct children.
 */
export const routes = [
  <Route key="/" path="/" element={<Navigate to="/catalog" replace />} />,
  <Route key="/catalog" path="/catalog" element={<CatalogPage />} />,
  <Route
    key="/catalog/:tuneId"
    path="/catalog/:tuneId"
    element={<TuneScreen parent={() => '/catalog'} />}
  />,
  <Route key="/lists" path="/lists" element={<ListsPage />} />,
  <Route key="/lists/:listId" path="/lists/:listId" element={<ListPage />} />,
  <Route
    key="/lists/:listId/tunes/:tuneId"
    path="/lists/:listId/tunes/:tuneId"
    element={<TuneScreen parent={({ listId }) => `/lists/${listId}`} />}
  />,
  <Route key="/recordings" path="/recordings" element={<RecordingsPage />} />,
  <Route
    key="/recordings/:tuneId"
    path="/recordings/:tuneId"
    element={<TuneScreen parent={() => '/recordings'} />}
  />,
  <Route key="/settings" path="/settings" element={<SettingsPage />} />,
  <Route key="/tunes/:tuneId" path="/tunes/:tuneId" element={<TuneRedirect />} />,
  // Links saved, bookmarked, or restored under the old name for a tune.
  <Route key="/songs/:tuneId" path="/songs/:tuneId" element={<TuneRedirect />} />,
  <Route
    key="/lists/:listId/songs/:tuneId"
    path="/lists/:listId/songs/:tuneId"
    element={<TuneScreen parent={({ listId }) => `/lists/${listId}`} />}
  />,
]
