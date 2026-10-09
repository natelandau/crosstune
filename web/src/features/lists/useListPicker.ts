import { useRef, useState } from 'react'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import { countBucket } from '../../usage/buckets'
import { addTunesToList, createListWithTunes, type Undo } from '../../commands/bulk'
import { useDb } from '../../db/DbProvider'
import { useAction } from '../../ui/useAction'
import { NONE_IN_IT } from './listPickerCopy'
import { useActiveLists, useMembershipCounts } from './useLists'

/**
 * What one successful add did. The picker reports the facts rather than a sentence, so the
 * caller words its own toast and holds the undo; the wording differs between the tune page
 * and a bulk selection.
 */
export interface ListAddition {
  undo: Undo
  /** How many of the selection were actually added, since a tune already in the list does not count again. */
  added: number
  listName: string
  /** True when the pick created the list rather than adding to one that already existed. */
  created: boolean
}

export interface ListPickerRow {
  id: string
  name: string
  /** How much of the selection the list holds, null until that is read. */
  note: string | null
  disabled: boolean
}

export interface ListPicker {
  rows: ListPickerRow[]
  creating: boolean
  setCreating: (creating: boolean) => void
  name: string
  setName: (name: string) => void
  add: (listId: string) => void
  create: () => void
  error: string | null
  pending: boolean
  /** Set by a successful pick or create; the sheet closes itself so a fast second tap has nothing to act on. */
  closing: boolean
  /** Cancel. */
  cancel: () => void
  /** The sheet's onClose: reports a dismissal once, whatever caused it. */
  dismissed: () => void
}

/** Adds one or more tunes to an existing list, or to a new one, without leaving the page behind it. */
export function useListPicker(
  open: boolean,
  userTuneIds: readonly string[],
  {
    excludeListId,
    onAdded,
    onClose,
  }: {
    /** Left off the offered lists, such as the list already open on the list detail screen. */
    excludeListId?: string
    /** What the add did, for a caller that toasts it and offers the undo. */
    onAdded?: (addition: ListAddition) => void
    onClose: () => void
  },
): ListPicker {
  const db = useDb()
  const analytics = useAnalytics()
  const lists = (useActiveLists() ?? []).filter((list) => list.id !== excludeListId)
  const counts = useMembershipCounts(userTuneIds)
  const total = userTuneIds.length
  const { error, pending, runThen, clear } = useAction()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [closing, setClosing] = useState(false)
  // A click handler reads `pending` before React commits the state from an earlier click in
  // the same tick, so the same-tick guard needs a ref instead.
  const busy = useRef(false)
  const [wasOpen, setWasOpen] = useState(open)

  // Reset during render, not an effect, so the sheet's next open already starts clean instead
  // of flashing the previous session's half-typed name for a frame.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) {
      setCreating(false)
      setName('')
      setClosing(false)
      clear()
    }
  }

  const dismissed = () => {
    busy.current = false
    onClose()
  }

  const rows = lists.map((list) => {
    const loaded = counts !== undefined
    const inList = counts?.get(list.id) ?? 0
    const full = loaded && total > 0 && inList >= total
    const note = !loaded
      ? null
      : inList === 0
        ? NONE_IN_IT
        : full
          ? 'all in it'
          : `${inList} of ${total} in it`
    return { id: list.id, name: list.name, note, disabled: full || pending || !loaded }
  })

  const finish = (write: () => Promise<ListAddition>) => {
    busy.current = true
    let addition: ListAddition | null = null
    runThen(
      async () => {
        try {
          addition = await write()
        } catch (caught) {
          busy.current = false
          throw caught
        }
      },
      () => {
        setClosing(true)
        // A write that lands without reporting itself would close the sheet with no toast and
        // no undo, so it fails here rather than degrading into a silent, unrepeatable add.
        if (!addition) throw new Error('The add reported nothing to undo')
        onAdded?.(addition)
      },
    )
  }

  const add = (listId: string) => {
    const list = lists.find((candidate) => candidate.id === listId)
    if (!list || busy.current || closing) return
    finish(async () => {
      const { undo, added } = await addTunesToList(db, list.id, userTuneIds)
      analytics.send('tunes_added_to_list', { list_id: list.id, count_bucket: countBucket(added) })
      return { undo, added, listName: list.name, created: false }
    })
  }

  const create = () => {
    const listName = name.trim()
    if (busy.current || closing || !listName) return
    finish(async () => {
      const { undo, listId } = await createListWithTunes(db, listName, userTuneIds)
      // One action, reported only as the list made; the tunes it starts with are its count.
      analytics.send('list_created', {
        list_id: listId,
        count_bucket: countBucket(new Set(userTuneIds).size),
      })
      return { undo, added: total, listName, created: true }
    })
  }

  return {
    rows,
    creating,
    setCreating,
    name,
    setName,
    add,
    create,
    error,
    pending,
    closing,
    cancel: () => setClosing(true),
    dismissed,
  }
}
