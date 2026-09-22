import { IonButton } from '@ionic/react'
import { useEffect, useRef, useState } from 'react'
import { updateRecording } from '../../commands/recordings'
import { useAction } from '../../ui/useAction'
import { useDb } from '../../db/DbProvider'
import { InlineError } from '../../ui/InlineError'
import { Sheet } from '../../ui/Sheet'
import { useToast } from '../../ui/Toast'
import type { CatalogEntry } from '../catalog/filters'
import { SEARCH_SONGS, SongSearch } from '../catalog/SongSearch'
import { useInstruments } from '../settings/useInstruments'
import { SongFormSheet, type SongFormTarget } from '../song/SongFormSheet'
import type { RecordingView } from './useRecordings'

export const ADD_TO_SONG_TITLE = 'Add to a song'
export const ADD_TO_SONG_ERROR = 'The recording could not be added to this song.'

/**
 * Search for the song a recording belongs to, or start a new one to file it under.
 *
 * This must stay mounted for as long as its parent screen lives, never behind a condition of its
 * own: the create path spans a dismissal, where `onClose` runs before the song form opens, so a
 * parent that unmounts this on that close would drop the half-finished create without a word.
 */
export function AddToSongSheet({
  view,
  onClose,
}: {
  /** The recording to file, or null for a closed sheet; the parent nulls it from onClose. */
  view: RecordingView | null
  onClose: () => void
}) {
  const db = useDb()
  const instruments = useInstruments()
  const toast = useToast()
  const { error, pending, runThen, clear } = useAction()
  const [query, setQuery] = useState('')
  const [closing, setClosing] = useState(false)
  const [openedFor, setOpenedFor] = useState<RecordingView | null>(null)
  const [form, setForm] = useState<SongFormTarget | null>(null)
  // The title chosen from the create offer, handed to the form once the picker has dismissed,
  // since an overlay presented while another is closing never appears.
  const creating = useRef<string | null>(null)
  // The recording the form will file, held past the close that clears `view`.
  const filing = useRef<string | null>(null)
  // A pick in flight. A ref, because two taps in one tick both read the same state.
  const picking = useRef(false)
  // The recording the sheet was presented for. Every way out ends here, including Escape, the
  // backdrop, a drag to the bottom, and the hardware back button, which dismiss with the
  // backdrop role rather than through `closing`.
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

  // A dismissal that ends after a new recording opened belongs to the old one, so it closes nothing.
  const dismissed = () => {
    if (presentedFor.current !== null && presentedFor.current !== view) return
    presentedFor.current = null
    picking.current = false
    const title = creating.current
    creating.current = null
    onClose()
    if (title !== null) setForm({ kind: 'new', title })
  }

  const pick = (entry: CatalogEntry) => {
    if (!view || closing || picking.current) return
    picking.current = true
    const id = view.recording.id
    runThen(
      async () => {
        await updateRecording(db, id, { song_id: entry.song.id }).catch((caught: unknown) => {
          picking.current = false
          throw caught
        })
      },
      () => setClosing(true),
    )
  }

  const create = (title: string) => {
    if (!view || closing || creating.current !== null) return
    creating.current = title
    filing.current = view.recording.id
    setClosing(true)
  }

  const saved = ({ songId }: { songId: string }) => {
    const id = filing.current
    filing.current = null
    setForm(null)
    if (id === null) return
    // The song already exists by now, so a refused filing reports where the closed sheet cannot.
    void updateRecording(db, id, { song_id: songId }).catch(() =>
      toast({ message: ADD_TO_SONG_ERROR }),
    )
  }

  return (
    <>
      <Sheet
        open={view !== null && !closing}
        title={ADD_TO_SONG_TITLE}
        onClose={dismissed}
        start={
          <IonButton disabled={pending} onClick={() => setClosing(true)}>
            Cancel
          </IonButton>
        }
      >
        {/* Mounted only while the sheet is in play: the search reads the whole catalog. */}
        {view ? (
          <>
            <SongSearch
              name={SEARCH_SONGS}
              rowName={(title) => `Add to ${title}`}
              onPick={pick}
              onCreate={create}
              query={query}
              onQuery={setQuery}
            />
            {error ? <InlineError className="px-(--form-inset) pt-2">{error}</InlineError> : null}
          </>
        ) : null}
      </Sheet>
      {/* The form fixes its tuning fields once, as it opens, so it waits for the settings row
          rather than opening against an empty set and showing none for the whole edit. */}
      {instruments ? (
        <SongFormSheet
          target={form}
          instruments={instruments}
          onClose={() => {
            filing.current = null
            setForm(null)
          }}
          onSaved={saved}
        />
      ) : null}
    </>
  )
}
