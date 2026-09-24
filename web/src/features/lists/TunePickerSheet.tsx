import { IonButton } from '@ionic/react'
import { useLayoutEffect, useRef, useState } from 'react'
import { addToList } from '../../commands/lists'
import { messageFor, useAction } from '../../ui/useAction'
import { useDb } from '../../db/DbProvider'
import { InlineError } from '../../ui/InlineError'
import { Sheet } from '../../ui/Sheet'
import { useToast } from '../../ui/Toast'
import type { CatalogEntry } from '../catalog/filters'
import { SEARCH_TUNES, TuneSearch } from '../catalog/TuneSearch'

export const IN_THIS_LIST = 'In this list'
export const ADD_TUNES = 'Add tunes'
export const PICKER_HINT = 'Search the catalog to add tunes.'

/** Search the catalog and add tunes to one list, several in one visit. */
export function TunePickerSheet({
  open,
  listId,
  taken,
  onClose,
  onCreate,
}: {
  open: boolean
  listId: string
  /** The user tune ids already in the list, from the screen's own query rather than a second one. */
  taken: ReadonlySet<string>
  onClose: () => void
  /** The musician chose to create a tune by this title; the picker has already closed. */
  onCreate: (title: string) => void
}) {
  const db = useDb()
  const { error, run, clear } = useAction()
  const toast = useToast()
  const [query, setQuery] = useState('')
  // Set by Done or the create offer; the sheet closes itself and reports it once, when
  // dismissal ends.
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

  const pick = (entry: CatalogEntry) => {
    const id = entry.userTune.id
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
        toast({ message: messageFor(caught) })
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

  return (
    <Sheet
      open={open && !closing}
      title={ADD_TUNES}
      onClose={() => {
        const title = creating.current
        creating.current = null
        gone.current = true
        onClose()
        if (title !== null) onCreate(title)
      }}
      end={
        <IonButton strong onClick={() => setClosing(true)}>
          Done
        </IonButton>
      }
    >
      {/* Mounted only while the sheet is in play: the search reads the whole catalog, and every
          list screen carries one of these. */}
      {open ? (
        <>
          <TuneSearch
            name={SEARCH_TUNES}
            taken={taken}
            takenLabel={IN_THIS_LIST}
            rowName={(title) => `Add ${title}`}
            onPick={pick}
            onCreate={create}
            query={query}
            onQuery={setQuery}
            keepFocus
          />
          {error ? <InlineError className="px-(--form-inset) pt-2">{error}</InlineError> : null}
          {!query.trim() ? (
            <p className="type-footnote px-(--form-inset) pt-4">{PICKER_HINT}</p>
          ) : null}
        </>
      ) : null}
    </Sheet>
  )
}
