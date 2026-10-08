import { useLiveQuery } from 'dexie-react-hooks'
import { useLayoutEffect, useRef, useState } from 'react'
import { addToList } from '../../commands/lists'
import { useDb } from '../../db/DbProvider'
import { messageFor, useAction } from '../../ui/useAction'
import { useTuneMatches, type TuneMatches } from '../catalog/useTuneMatches'

export interface TunePicker {
  query: string
  setQuery: (query: string) => void
  /** The catalog narrowed by the query, and what the search offers beyond the matches. */
  matches: TuneMatches
  /** The user tune ids already in the list. */
  taken: ReadonlySet<string>
  /** Adds a tune without closing, so several go in one visit. */
  pick: (userTuneId: string) => void
  /** Asks to create a tune by this title; the picker closes first and `dismissed` hands the title back. */
  create: (title: string) => void
  /** The last rejection of a pick, while the visit that made it is still open. */
  error: string | null
  /** Set by Done or the create offer; the sheet closes itself and reports once, when dismissal ends. */
  closing: boolean
  /** Done. */
  done: () => void
  /** The sheet's onClose: the title to create, if the close was a create offer. */
  dismissed: () => string | null
}

const NOTHING_TAKEN: ReadonlySet<string> = new Set()

/** Search the catalog and add tunes to one list, several in one visit. */
export function useTunePicker(
  open: boolean,
  listId: string,
  {
    toast,
    taken: given,
  }: {
    toast: (message: string) => void
    /** The caller's own read of the list's tunes; without it the picker reads them itself. */
    taken?: ReadonlySet<string>
  },
): TunePicker {
  const db = useDb()
  const { error, run, clear } = useAction()
  const [query, setQuery] = useState('')
  const [closing, setClosing] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  // Tunes whose add is in flight. A ref, because two taps in one tick both read the same state.
  const adding = useRef(new Set<string>())
  const creating = useRef<string | null>(null)
  // Whether the sheet has closed since it last opened, so a rejection knows if its inline error
  // still has a surface.
  const gone = useRef(false)
  // Which visit a pick belongs to, so a rejection that outlives its visit reports as a toast
  // rather than landing inline on a later one.
  const visit = useRef(0)

  // Reset during render, not an effect, so the next open already starts clean instead of
  // flashing the previous visit's search for a frame.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setQuery('')
      setClosing(false)
      clear()
    }
  }

  useLayoutEffect(() => {
    if (!open) return
    gone.current = false
    visit.current += 1
  }, [open])

  const own = useLiveQuery(async () => {
    if (!open || given) return undefined
    const items = await db.list_items.where('list_id').equals(listId).toArray()
    return new Set(items.filter((item) => !item.deleted_at).map((item) => item.user_tune_id))
  }, [db, listId, open, given])
  const taken = given ?? own ?? NOTHING_TAKEN

  const found = useTuneMatches(query, open)

  const pick = (id: string) => {
    if (adding.current.has(id)) return
    adding.current.add(id)
    const at = visit.current
    setQuery('')
    run(async () => {
      try {
        await addToList(db, listId, id)
      } catch (caught) {
        // Adding several tunes means the sheet must close on Done whatever is in flight, so a
        // rejection that outlives the visit that made it takes the app's toast instead of an
        // error line that no longer belongs to it.
        if (!gone.current && at === visit.current) throw caught
        toast(messageFor(caught))
      } finally {
        adding.current.delete(id)
      }
    })
  }

  const create = (title: string) => {
    if (creating.current !== null) return
    creating.current = title
    setClosing(true)
  }

  const dismissed = () => {
    const title = creating.current
    creating.current = null
    gone.current = true
    return title
  }

  return {
    query,
    setQuery,
    matches: found,
    taken,
    pick,
    create,
    error,
    closing,
    done: () => setClosing(true),
    dismissed,
  }
}
