import { useEffect, useRef, useState } from 'react'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import { updateRecording } from '../../commands/recordings'
import { useDb } from '../../db/DbProvider'
import { messageFor, useAction } from '../../ui/useAction'
import { useTuneMatches, type TuneMatches } from '../catalog/useTuneMatches'
import { reportRecordingFiled } from './reportRecordingFiled'
import { filedToast } from './recordingsCopy'
import type { RecordingView } from './useRecordings'

export interface AddToTune {
  /** Whether the sheet shows: it has a recording and nothing has asked it to close. */
  open: boolean
  closing: boolean
  /** True while a pick is being filed. */
  pending: boolean
  query: string
  setQuery: (query: string) => void
  /** The catalog narrowed by the query, and what the search offers beyond the matches. */
  matches: TuneMatches
  /** Files the recording under this tune, by tune id, then closes. */
  pick: (tuneId: string) => void
  /** Asks to create a tune by this title; the sheet closes first and `dismissed` hands it back. */
  create: (title: string) => void
  cancel: () => void
  /**
   * The sheet's onClose, run once its dismissal ends. Calls `onClose`, then returns the title
   * to open the tune form with, if the close was a create offer.
   */
  dismissed: () => string | null
  /** The last refusal of a pick. */
  error: string | null
}

/**
 * Search for the tune a recording belongs to, or start a new one to file it under. `view` is
 * null for a closed sheet; the parent nulls it from `onClose`.
 *
 * The create path spans a dismissal, where `onClose` runs before the tune form opens, so the
 * caller must keep this hook mounted for as long as its screen lives.
 */
export function useAddToTune(
  view: RecordingView | null,
  {
    toast,
    onClose,
    undoToast = true,
  }: {
    toast: (message: string, undo?: () => void) => void
    onClose: () => void
    /** Whether a pick raises a toast with Undo once the recording is filed. */
    undoToast?: boolean
  },
): AddToTune {
  const db = useDb()
  const analytics = useAnalytics()
  const { error, pending, runThen, clear } = useAction()
  const [query, setQuery] = useState('')
  const [closing, setClosing] = useState(false)
  const [openedFor, setOpenedFor] = useState<RecordingView | null>(null)
  // The title chosen from the create offer, handed back once the sheet has dismissed, since an
  // overlay presented while another is closing never appears.
  const creating = useRef<string | null>(null)
  // A pick in flight. A ref, because two taps in one tick both read the same state.
  const picking = useRef(false)
  // The recording the sheet was presented for. Every way out ends here, including Escape, the
  // backdrop, and a drag down, which dismiss without going through `closing`.
  const presentedFor = useRef<RecordingView | null>(null)

  // Reset during render, not an effect, so the next open already starts clean instead of
  // flashing the previous recording's search for a frame.
  if (view !== openedFor) {
    setOpenedFor(view)
    if (view) {
      setQuery('')
      setClosing(false)
      clear()
    }
  }

  useEffect(() => {
    if (view) presentedFor.current = view
  }, [view])

  const found = useTuneMatches(query, view !== null)
  const { entries } = found

  const refile = (id: string, tuneId: string | null) => () =>
    void updateRecording(db, id, { tune_id: tuneId }).catch((caught: unknown) =>
      toast(messageFor(caught)),
    )

  const pick = (tuneId: string) => {
    if (!view || closing || picking.current) return
    picking.current = true
    const id = view.recording.id
    const before = view.tuneId
    const title = entries?.find((entry) => entry.tune.id === tuneId)?.tune.title
    runThen(
      async () => {
        await updateRecording(db, id, { tune_id: tuneId }).catch((caught: unknown) => {
          picking.current = false
          throw caught
        })
        reportRecordingFiled(analytics, view.recording, tuneId)
      },
      () => {
        setClosing(true)
        if (undoToast && title !== undefined) toast(filedToast(title), refile(id, before))
      },
    )
  }

  const create = (title: string) => {
    if (!view || closing || creating.current !== null) return
    creating.current = title
    setClosing(true)
  }

  // A dismissal that ends after a new recording opened belongs to the old one, so it closes nothing.
  const dismissed = () => {
    if (presentedFor.current !== null && presentedFor.current !== view) return null
    presentedFor.current = null
    picking.current = false
    const title = creating.current
    creating.current = null
    onClose()
    return title
  }

  return {
    open: view !== null && !closing,
    closing,
    pending,
    query,
    setQuery,
    matches: found,
    pick,
    create,
    cancel: () => setClosing(true),
    dismissed,
    error,
  }
}
