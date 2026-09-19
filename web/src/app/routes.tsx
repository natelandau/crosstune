import { Navigate, Route } from 'react-router-dom'
import { CatalogPage } from '../features/catalog/CatalogPage'
import { ListPage } from '../features/lists/ListPage'
import { ListsPage } from '../features/lists/ListsPage'
import { RecordingsPage } from '../features/recordings/RecordingsPage'
import { SettingsPage } from '../features/settings/SettingsPage'
import { SongScreen } from '../features/song/SongScreen'
import { SongRedirect } from './SongRedirect'

/**
 * Tab-scoped, the way native stacks work: a song opened from a list stays in the Lists tab
 * and Back returns to the list. The song page is one component mounted at every path that
 * shows a song. An array, not a fragment, because the outlet reads its routes from its
 * direct children.
 */
export const routes = [
  <Route key="/" path="/" element={<Navigate to="/catalog" replace />} />,
  <Route key="/catalog" path="/catalog" element={<CatalogPage />} />,
  <Route
    key="/catalog/:songId"
    path="/catalog/:songId"
    element={<SongScreen parent={() => '/catalog'} />}
  />,
  <Route key="/lists" path="/lists" element={<ListsPage />} />,
  <Route key="/lists/:listId" path="/lists/:listId" element={<ListPage />} />,
  <Route
    key="/lists/:listId/songs/:songId"
    path="/lists/:listId/songs/:songId"
    element={<SongScreen parent={({ listId }) => `/lists/${listId}`} />}
  />,
  <Route key="/recordings" path="/recordings" element={<RecordingsPage />} />,
  <Route
    key="/recordings/:songId"
    path="/recordings/:songId"
    element={<SongScreen parent={() => '/recordings'} />}
  />,
  <Route key="/settings" path="/settings" element={<SettingsPage />} />,
  <Route key="/songs/:songId" path="/songs/:songId" element={<SongRedirect />} />,
]
