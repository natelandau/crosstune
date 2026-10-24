import type { ReactNode } from 'react'
import { recordingTx } from '../../commands/write'
import { useDb } from '../../db/DbProvider'
import { useToast } from '../../ui/Toast'
import { messageFor } from '../../ui/useAction'
import { markFresh } from './freshTune'
import { tuneHasWork } from './tuneHasWork'
import { addedMessage, keptMessage } from './tuneScreenCopy'
import { AddTuneContext, type AddTune } from './useAddTune'
import { useCreateTune } from './useCreateTune'
import { useTuneActions } from './useTuneActions'

/**
 * Owns the create-with-Undo for the catalog's screens. It stays mounted across the new-tune
 * page and the tune pages, so a failed Undo has a toast to land on. Undo leaves the musician
 * where they are: the tune's own page leaves for the catalog once the tune is gone, and any
 * other page has nothing to do with it.
 */
export function AddTuneProvider({ children }: { children: ReactNode }) {
  const db = useDb()
  const tuneActions = useTuneActions()
  const toast = useToast()
  const createTune = useCreateTune()
  const undoAdd = async (id: string, title: string) => {
    try {
      // The page withdraws Undo as work arrives, but only while it shows; work added after
      // it was left must survive too. One transaction, so no work lands between the check
      // and the delete.
      const kept = await recordingTx(db, async () => {
        // Deleted already, here or on another device, which reported it then.
        const tune = await db.tunes.get(id)
        if (!tune || tune.deleted_at) return false
        if (await tuneHasWork(db, id)) return true
        await tuneActions.remove(id)
        return false
      })
      if (kept) toast.show(keptMessage(title))
    } catch (caught) {
      toast.show(messageFor(caught))
    }
  }
  const addTune: AddTune = async (options) => {
    const { tuneId, title } = await createTune(options)
    const toastId = toast.show(addedMessage(title), () => void undoAdd(tuneId, title))
    // Marked before the page opens, so the page finds it as it mounts.
    markFresh(tuneId, toastId)
    return tuneId
  }
  return <AddTuneContext value={addTune}>{children}</AddTuneContext>
}
