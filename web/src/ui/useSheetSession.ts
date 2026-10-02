import { useRef, useState } from 'react'

export interface SheetSession {
  /** Whether the sheet shows: it has a target and nothing has asked it to close. */
  open: boolean
  /** Cancel or a save asked the sheet to close; it reports that once dismissal ends. */
  closing: boolean
  close: () => void
  /** Whether a save may start now: none is running for this target and the sheet is not closing. */
  canSave: () => boolean
  beginSave: () => void
  /** Let the next submit try again, then rethrow for the action to report. */
  saveFailed: (error: unknown) => never
  /** The sheet's onClose, run once its dismissal ends. */
  dismissed: () => void
}

/**
 * The lifecycle a form sheet over one target shares: reset on open, save at most once per
 * target, and close only when the parent's target and the sheet's dismissal agree. `target`
 * is null while closed; the parent nulls it from `onClose`.
 */
export function useSheetSession<T>(
  target: T | null,
  { onOpen, onClose }: { onOpen: (target: T) => void; onClose: () => void },
): SheetSession {
  const [closing, setClosing] = useState(false)
  const [openedFor, setOpenedFor] = useState<T | null>(null)
  // A ref, because two submits in one tick both read the same render's state.
  const saving = useRef<T | null>(null)

  // Reset during render so the sheet's first frame already shows the new target's values.
  if (target !== openedFor) {
    setOpenedFor(target)
    if (target !== null) {
      setClosing(false)
      onOpen(target)
    }
  }

  return {
    open: target !== null && !closing,
    closing,
    close: () => setClosing(true),
    canSave: () => target !== null && !closing && saving.current !== target,
    beginSave: () => {
      saving.current = target
    },
    saveFailed: (error) => {
      saving.current = null
      throw error
    },
    // A dismissal that ends after a new target opened belongs to the old one, so it closes
    // nothing. The parent may reopen with the very target just saved, so saving clears here.
    dismissed: () => {
      saving.current = null
      if (target === null || closing) onClose()
    },
  }
}
