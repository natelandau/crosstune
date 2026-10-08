import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConfirmQuestion } from './confirmQuestion'
import { messageFor } from './useAction'
import { useLatest } from './useLatest'
import { useResetOnChange } from './useResetOnChange'

export interface DeleteAndLeave {
  /** The name of the thing whose confirmed delete is running, so a live query reporting it gone
   * is not mistaken for a delete made elsewhere while the page leaves. */
  deletingName: string | null
  /** Asks, then deletes, then leaves. A second call before the first settles does nothing. */
  start: (name: string, question: ConfirmQuestion) => Promise<void>
}

/**
 * The confirm, delete, leave sequence of a page that deletes the thing it shows. The page
 * leaves only after the write lands, and a failed write puts the page back as it was.
 */
export function useDeleteAndLeave({
  confirm,
  remove,
  leave,
  onStart,
  onError,
  subject,
}: {
  confirm: (question: ConfirmQuestion) => Promise<boolean>
  remove: () => Promise<void>
  leave: () => void
  /** Runs once the delete is confirmed, for a page that clears its own error line. */
  onStart?: () => void
  /** Takes a failed delete's message, for a page that shows errors on its own line. */
  onError?: (message: string) => void
  /** Names what the page shows. When it changes, a question or delete under way no longer
   * belongs to the page: it deletes nothing further, does not leave, and reports nothing. */
  subject?: unknown
}): DeleteAndLeave {
  const [deletingName, setDeletingName] = useState<string | null>(null)
  // The subject of the delete in flight, held in a ref because two presses in one tick both read
  // the same committed state. A delete counts as busy only for the subject it started on, so
  // opening another subject frees the guard without the abandoned one touching it again.
  const inFlight = useRef<{ subject: unknown } | null>(null)
  const subjectRef = useLatest(subject)
  const asking = useRef<AbortController | null>(null)
  const latest = useLatest({ confirm, leave, onStart, onError })

  useResetOnChange(subject, () => setDeletingName(null))
  // A question about the subject that was left is withdrawn, so no dialog outlives its page.
  useEffect(
    () => () => {
      asking.current?.abort()
      asking.current = null
    },
    [subject],
  )

  const start = useCallback(
    async (name: string, question: ConfirmQuestion) => {
      // Taken from this callback's own render, with `remove`, so the question, the write, and the
      // subject they name always agree.
      const mine = subject
      if (inFlight.current && Object.is(inFlight.current.subject, mine)) return
      const token = { subject: mine }
      inFlight.current = token
      const same = () => Object.is(subjectRef.current, mine)
      // Clears only this call's own token, so an abandoned call never frees a newer one's guard.
      const release = () => {
        if (inFlight.current === token) inFlight.current = null
      }
      const controller = new AbortController()
      asking.current = controller
      const ok = await latest.current.confirm({ ...question, signal: controller.signal })
      if (asking.current === controller) asking.current = null
      if (!ok) {
        release()
        return
      }
      // Another subject owns the page now; this answer belongs to the one it left.
      if (!same()) {
        release()
        return
      }
      const { leave, onStart, onError } = latest.current
      onStart?.()
      setDeletingName(name)
      try {
        await remove()
      } catch (caught) {
        release()
        if (!same()) return
        setDeletingName(null)
        onError?.(messageFor(caught))
        return
      }
      // A delete that landed stays busy until the page has left, so a press during the exit
      // animation cannot ask again.
      if (same()) leave()
      else release()
    },
    [latest, subjectRef, remove, subject],
  )

  return { deletingName, start }
}
