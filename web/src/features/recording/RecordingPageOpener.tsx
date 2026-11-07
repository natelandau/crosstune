import { useCallback, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { recordingPath } from '../../layout/tuneHome'
import { newId } from '../../commands/write'
import { useLatest } from '../../ui/useLatest'
import { RecordingPageOpenerContext, type OpenRecordingPage } from '../player/recordingPageOpener'
import { recordingPageParent } from './recordingPageParent'
import { entryOf, type RecordingPageState } from './recordingPageState'

/**
 * Hands every opener of a recording's page one way in, inside the router: it picks the page's
 * parent from where the musician is and pushes the page's address. Opening the page that
 * already shows replaces it, so the Practice an opener asked for shows without a second entry.
 */
export function RecordingPageOpener({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const pathnameRef = useLatest(location.pathname)
  const stateRef = useLatest(location.state)
  const open = useCallback<OpenRecordingPage>(
    (recordingId, { tuneId, ...opening }) => {
      const at = pathnameRef.current
      const to = recordingPath(recordingPageParent(at, tuneId), recordingId)
      const replace = to === at
      // Opening the page that shows keeps where it came from, so Back still returns there.
      const from = (replace ? entryOf(stateRef.current).from : undefined) ?? at
      const state: RecordingPageState = { recordingPage: { ...opening, id: newId(), from } }
      void navigate(to, { state, replace })
    },
    [navigate, pathnameRef, stateRef],
  )
  return (
    <RecordingPageOpenerContext.Provider value={open}>
      {children}
    </RecordingPageOpenerContext.Provider>
  )
}
