import { useState } from 'react'
import { createList, renameList } from '../../commands/lists'
import { LIST_NAME_REQUIRED } from '../../commands/messages'
import { useDb } from '../../db/DbProvider'
import { useAction } from '../../ui/useAction'
import { useSheetSession } from '../../ui/useSheetSession'

export type ListNameTarget = { kind: 'new' } | { kind: 'rename'; listId: string; name: string }

export interface ListName {
  open: boolean
  closing: boolean
  /** Whether the open sheet renames a list; holds its last value while the sheet animates closed. */
  renaming: boolean
  name: string
  setName: (name: string) => void
  /** Why the name cannot be saved yet. */
  invalid: string | null
  /** The last failed save. */
  error: string | null
  pending: boolean
  save: () => void
  close: () => void
  /** The sheet's onClose, run once its dismissal ends. */
  dismissed: () => void
}

/** Naming a new list or renaming one, over whatever screen asked. `target` is null while closed. */
export function useListName(
  target: ListNameTarget | null,
  {
    onSaved,
    onClose,
    onInvalid,
  }: {
    /** After a successful save, with the list's id. */
    onSaved: (listId: string) => void
    /** The sheet has finished closing; the parent nulls its target. */
    onClose: () => void
    /** A save was refused, so the caller can put focus back in the field. */
    onInvalid?: () => void
  },
): ListName {
  const db = useDb()
  const { error, pending, runThen, clear } = useAction()
  const [name, setNameState] = useState('')
  const [invalid, setInvalid] = useState<string | null>(null)
  const sheet = useSheetSession(target, {
    onOpen: (opened) => {
      setNameState(opened.kind === 'rename' ? opened.name : '')
      setInvalid(null)
      clear()
    },
    onClose,
  })

  const setName = (next: string) => {
    setNameState(next)
    setInvalid(null)
    clear()
  }

  const save = () => {
    if (!target || !sheet.canSave()) return
    const trimmed = name.trim()
    if (!trimmed) {
      clear()
      setInvalid(LIST_NAME_REQUIRED)
      onInvalid?.()
      return
    }
    setInvalid(null)
    sheet.beginSave()
    const current = target
    let listId = current.kind === 'rename' ? current.listId : ''
    runThen(
      async () => {
        try {
          if (current.kind === 'new') listId = await createList(db, trimmed)
          else await renameList(db, current.listId, trimmed)
        } catch (caught) {
          sheet.saveFailed(caught)
        }
      },
      () => {
        sheet.close()
        onSaved(listId)
      },
    )
  }

  return {
    open: sheet.open,
    closing: sheet.closing,
    // The last target, so the title does not flip while the sheet animates closed.
    renaming: sheet.shown?.kind === 'rename',
    name,
    setName,
    invalid,
    error,
    pending,
    save,
    close: sheet.close,
    dismissed: sheet.dismissed,
  }
}
