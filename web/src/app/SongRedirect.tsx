import { Navigate, useParams } from 'react-router-dom'

/** A `/songs/:songId` link opens the song in the Catalog stack. */
export function SongRedirect() {
  const { songId } = useParams()
  return <Navigate to={`/catalog/${songId}`} replace />
}
