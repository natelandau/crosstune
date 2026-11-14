import { useLiveQuery } from 'dexie-react-hooks'
import { useLayoutEffect, useRef, useState } from 'react'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import { countBucket } from '../../usage/buckets'
import { setTuneInList } from '../../commands/lists'
import { useDb } from '../../db/DbProvider'
import { messageFor, useAction } from '../../ui/useAction'
import { useResetOnChange } from '../../ui/useResetOnChange'
import { useTuneMatches, type TuneMatches } from '../catalog/useTuneMatches'
import { useCreateTune } from '../tune/useCreateTune'

export interface TunePicker {
  query: string
  setQuery: (query: string) => void
  /** The catalog narrowed by the query, and what the search offers beyond the matches. */
  matches: TuneMatches
  /** The user tune ids already in the list. */
  taken: ReadonlySet<string>
  /**
   * Adds a tune, or takes it out when it is already in the list, without closing, so several go
   * in one visit. The search stays as typed, so the next tune can come from the same results.
   */
  pick: (userTuneId: string) => void
  /** Creates a tune by this title into the list, keeping the search so it shows as taken. */
  create: (title: string) => void
  /** The last rejection of a pick, while the visit that made it is still open. */
  error: string | null
  /** The sheet closed, by Done or a dismissal; reports the visit once its changes end. */
  dismissed: () => void
}

const NOTHING_TAKEN: ReadonlySet<string> = new Set()

interface Visit {
  /** The sheet has closed since this visit opened, so its inline error has no surface. */
  gone: boolean
  /** Adds and removals still running. */
  running: number
  /** Tunes added and removed, reported together once the sheet has closed and nothing runs. */
  added: number
  removed: number
}

const newVisit = (): Visit => ({ gone: false, running: 0, added: 0, removed: 0 })

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
  const analytics = useAnalytics()
  const createTune = useCreateTune()
  const { error, run, clear } = useAction()
  const [query, setQuery] = useState('')
  // Tunes whose add or removal is in flight. A ref, because two taps in one tick both read the
  // same state.
  const changing = useRef(new Set<string>())
  // A create in flight, so a second press or Enter cannot make the tune twice.
  const creating = useRef(false)
  // The open visit. A pick keeps the visit it was made in, so a rejection that outlives it
  // reports as a toast rather than landing inline on a later one, and its add counts toward
  // that visit's report.
  const visit = useRef<Visit>(newVisit())

  // Reset during render, not an effect, so the next open already starts clean instead of
  // flashing the previous visit's search for a frame.
  useResetOnChange(open, () => {
    if (open) {
      setQuery('')
      clear()
    }
  })

  useLayoutEffect(() => {
    if (open) visit.current = newVisit()
  }, [open])

  const own = useLiveQuery(async () => {
    if (!open || given) return undefined
    const items = await db.list_items.where('list_id').equals(listId).toArray()
    return new Set(items.filter((item) => !item.deleted_at).map((item) => item.user_tune_id))
  }, [db, listId, open, given])
  const taken = given ?? own ?? NOTHING_TAKEN

  const found = useTuneMatches(query, open)

  const reportIfDone = (done: Visit) => {
    if (!done.gone || done.running > 0) return
    if (done.added > 0) {
      analytics.send('tunes_added_to_list', {
        list_id: listId,
        count_bucket: countBucket(done.added),
      })
    }
    if (done.removed > 0) {
      analytics.send('tunes_removed_from_list', {
        list_id: listId,
        count_bucket: countBucket(done.removed),
      })
    }
    done.added = 0
    done.removed = 0
  }

  const pick = (id: string) => {
    if (changing.current.has(id)) return
    changing.current.add(id)
    const adds = !taken.has(id)
    const at = visit.current
    at.running += 1
    run(async () => {
      try {
        // The press asks for the state the row showed; a list that already had it counts nothing.
        if (await setTuneInList(db, listId, id, adds)) {
          if (adds) at.added += 1
          else at.removed += 1
        }
      } catch (caught) {
        // Adding several tunes means the sheet must close on Done whatever is in flight, so a
        // rejection that outlives the visit that made it takes the app's toast instead of an
        // error line that no longer belongs to it.
        if (!at.gone && at === visit.current) throw caught
        toast(messageFor(caught))
      } finally {
        changing.current.delete(id)
        at.running -= 1
        reportIfDone(at)
      }
    })
  }

  const create = (title: string) => {
    if (creating.current) return
    creating.current = true
    const at = visit.current
    run(async () => {
      try {
        const { filingError } = await createTune({ title, source: 'list', listId })
        if (filingError !== undefined) throw new Error(filingError)
      } catch (caught) {
        // As with a pick, a refusal that outlives its visit takes the toast.
        if (!at.gone && at === visit.current) throw caught
        toast(messageFor(caught))
      } finally {
        creating.current = false
      }
    })
  }

  const dismissed = () => {
    visit.current.gone = true
    reportIfDone(visit.current)
  }

  return {
    query,
    setQuery,
    matches: found,
    taken,
    pick,
    create,
    error,
    dismissed,
  }
}
