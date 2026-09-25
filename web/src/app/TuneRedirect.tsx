import { Navigate, useParams } from 'react-router-dom'

/** A `/tunes/:tuneId` link opens the tune in the Catalog stack. */
export function TuneRedirect() {
  const { tuneId } = useParams()
  return <Navigate to={`/catalog/${tuneId}`} replace />
}
