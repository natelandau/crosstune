import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import type { PlaceMethod } from '../../usage/events'
import { recordingOrigin } from '../../usage/origin'
import { updateRecording } from '../../commands/recordings'
import { useDb } from '../../db/DbProvider'
import { isRecordingPrecision, type LocalRecording } from '../../db/types'
import { isFullYear, narrowedParts, NO_DATE, sameParts, type DateParts } from '../../ui/partialDate'
import { useAction } from '../../ui/useAction'
import { useSheetSession } from '../../ui/useSheetSession'
import { recordedTime } from '../../text/format'
import { recordedAtNote } from './recordingCopy'
import {
  recentPlaces,
  recordingPlace,
  recordingPlayers,
  samePlace,
  type PlaceChoice,
} from './place'
import { datePatch, partsOf, type StoredDate } from './recordedDateParts'
import type { RecordingView } from './useRecordings'

export interface EditRecording {
  /** Whether the sheet shows. */
  open: boolean
  /** Cancel or a save asked the sheet to close. */
  closing: boolean
  name: string
  /** Sets the name and drops the last save's refusal. */
  setName: (name: string) => void
  parts: DateParts
  /** Narrows the date: a day needs a month, and a month needs a full year. */
  editParts: (patch: Partial<DateParts>) => void
  monthEnabled: boolean
  dayEnabled: boolean
  /** Whether there is a date for Clear date to clear. */
  canClearDate: boolean
  clearDate: () => void
  /** The take's exact time, shown only while its date parts are left alone. */
  timeNote: string | null
  dateError: string | null
  notes: string
  setNotes: (notes: string) => void
  players: string
  setPlayers: (players: string) => void
  /** The players on the musician's recordings, to suggest. */
  playerSuggestions: string[]
  place: PlaceChoice | null
  /** Whether Clear has a place to clear: a named one, or coordinates with no name yet. */
  canClearPlace: boolean
  /** Sets the place, or clears it with null, and how it was picked. */
  setPlace: (place: PlaceChoice | null, method: PlaceMethod | null) => void
  /** The places on the musician's recordings, this one's included, most recent first. */
  recentPlaces: PlaceChoice[]
  /** The last save's refusal. */
  error: string | null
  pending: boolean
  /** Whether any field differs from what the sheet opened with. */
  dirty: boolean
  save: () => void
  close: () => void
  /** The sheet's onClose, run once its dismissal ends. */
  dismissed: () => void
}

/**
 * A recording's name, the date it was recorded, its notes, players, and place. The date is a
 * year, optionally narrowed to a month and a day; a take's exact time survives only while its
 * date parts are left alone. A place left alone keeps its accuracy. `view` is null for a closed
 * sheet; the parent nulls it from `onClose`.
 */
export function useEditRecording(
  view: RecordingView | null,
  {
    onClose,
    onDateError,
  }: {
    onClose: () => void
    /** Runs when a save is refused for its date, to move focus to the year. */
    onDateError?: () => void
  },
): EditRecording {
  const db = useDb()
  const analytics = useAnalytics()
  const { error, pending, runThen, clear } = useAction()
  const [name, setNameState] = useState('')
  const [openedName, setOpenedName] = useState('')
  const [parts, setParts] = useState<DateParts>(NO_DATE)
  const [openedParts, setOpenedParts] = useState<DateParts>(NO_DATE)
  const [openedTime, setOpenedTime] = useState<string | null>(null)
  const [dateError, setDateError] = useState<string | null>(null)
  const [notes, setNotesState] = useState('')
  const [openedNotes, setOpenedNotes] = useState('')
  const [players, setPlayersState] = useState('')
  const [openedPlayers, setOpenedPlayers] = useState('')
  const [place, setPlaceState] = useState<PlaceChoice | null>(null)
  const [openedPlace, setOpenedPlace] = useState<PlaceChoice | null>(null)
  const [placeMethod, setPlaceMethod] = useState<PlaceMethod | null>(null)
  // Coordinates with no name show no place, yet the musician can still clear them.
  const [unnamedCoords, setUnnamedCoords] = useState(false)
  const [openedUnnamedCoords, setOpenedUnnamedCoords] = useState(false)
  const showing = view !== null
  // Read only while the sheet shows, so a closed sheet never re-reads on every recording write.
  const recordings = useLiveQuery(() => (showing ? db.recordings.toArray() : []), [db, showing])
  const viewId = view?.recording.id ?? null
  const playerSuggestions = useMemo(() => recordingPlayers(recordings ?? []), [recordings])
  const placesBefore = useMemo(() => recentPlaces(recordings ?? []), [recordings])
  // The stored values on open, whatever a cancelled edit left in the fields.
  const sheet = useSheetSession(view, {
    onOpen: (opened) => {
      const { label, recorded_at: at, recorded_precision: precision } = opened.recording
      const known = isRecordingPrecision(precision) ? precision : null
      const start = partsOf(at, known)
      setNameState(label ?? '')
      setOpenedName(label ?? '')
      setParts(start)
      setOpenedParts(start)
      setOpenedTime(at && known === 'time' ? recordedTime(at) : null)
      setDateError(null)
      setNotesState(opened.recording.notes ?? '')
      setOpenedNotes(opened.recording.notes ?? '')
      setPlayersState(opened.recording.players ?? '')
      setOpenedPlayers(opened.recording.players ?? '')
      setPlaceState(recordingPlace(opened.recording))
      setOpenedPlace(recordingPlace(opened.recording))
      setPlaceMethod(null)
      const unnamed = hasUnnamedCoords(opened.recording)
      setUnnamedCoords(unnamed)
      setOpenedUnnamedCoords(unnamed)
      clear()
    },
    onClose,
  })

  // The server names a take's coordinates after it syncs, which can land while the sheet is open.
  // A place the musician has left alone takes the name as if the sheet had opened with it.
  const liveRow = viewId ? recordings?.find((r) => r.id === viewId) : undefined
  const arrived =
    liveRow && openedUnnamedCoords && unnamedCoords && place === null
      ? recordingPlace(liveRow)
      : null
  if (arrived) {
    setPlaceState(arrived)
    setOpenedPlace(arrived)
    setUnnamedCoords(false)
    setOpenedUnnamedCoords(false)
  }

  const dateUnchanged = sameParts(parts, openedParts)
  const placeUnchanged = samePlace(place, openedPlace) && unnamedCoords === openedUnnamedCoords
  const monthEnabled = isFullYear(parts.year)

  const setName = (next: string) => {
    setNameState(next)
    clear()
  }

  const setNotes = (next: string) => {
    setNotesState(next)
    clear()
  }

  const setPlayers = (next: string) => {
    setPlayersState(next)
    clear()
  }

  const setPlace = (next: PlaceChoice | null, method: PlaceMethod | null) => {
    setPlaceState(next)
    setPlaceMethod(method)
    setUnnamedCoords(false)
    clear()
  }

  const editParts = (patch: Partial<DateParts>) => {
    setDateError(null)
    setParts((current) => narrowedParts(current, patch))
  }

  const save = () => {
    // Enter reaches this through a form submit, which a disabled Save does not cover.
    if (!view || !sheet.canSave()) return
    const label = name.trim() || null
    let date: StoredDate | undefined
    if (!dateUnchanged) {
      const patch = datePatch(parts)
      if ('error' in patch) {
        clear()
        setDateError(patch.error)
        onDateError?.()
        return
      }
      date = patch
    }
    // A field left alone is not written, so an edit synced while the sheet is open survives and
    // an untouched place keeps its captured accuracy; a picked one has none.
    const placePatch = placeUnchanged
      ? {}
      : {
          place_name: place?.name ?? null,
          place_lat: place?.lat ?? null,
          place_lon: place?.lon ?? null,
          place_accuracy_m: null,
        }
    sheet.beginSave()
    runThen(async () => {
      await updateRecording(db, view.recording.id, {
        label,
        ...date,
        ...(notes === openedNotes ? {} : { notes: blankToNull(notes) }),
        ...(players === openedPlayers ? {} : { players: blankToNull(players) }),
        ...placePatch,
      }).catch(sheet.saveFailed)
      const recordingId = view.recording.id
      if (label !== (view.recording.label ?? null)) {
        analytics.send('recording_renamed', {
          origin: recordingOrigin(view.recording),
          recording_id: recordingId,
        })
      }
      if (!placeUnchanged && place && placeMethod) {
        analytics.send('recording_place_set', {
          method: placeMethod,
          recording_id: recordingId,
          replaced: openedPlace !== null,
        })
      } else if (!placeUnchanged && !place) {
        analytics.send('recording_place_cleared', { recording_id: recordingId })
      }
    }, sheet.close)
  }

  return {
    open: sheet.open,
    closing: sheet.closing,
    name,
    setName,
    parts,
    editParts,
    monthEnabled,
    dayEnabled: monthEnabled && parts.month !== '',
    canClearDate: !sameParts(parts, NO_DATE),
    clearDate: () => editParts(NO_DATE),
    timeNote: openedTime && dateUnchanged ? recordedAtNote(openedTime) : null,
    dateError,
    notes,
    setNotes,
    players,
    setPlayers,
    playerSuggestions,
    place,
    canClearPlace: place !== null || unnamedCoords,
    setPlace,
    recentPlaces: placesBefore,
    error,
    pending,
    dirty:
      name !== openedName ||
      !dateUnchanged ||
      notes !== openedNotes ||
      players !== openedPlayers ||
      !placeUnchanged,
    save,
    close: sheet.close,
    dismissed: sheet.dismissed,
  }
}

const hasUnnamedCoords = (r: LocalRecording): boolean =>
  !r.place_name && r.place_lat != null && r.place_lon != null

const blankToNull = (value: string): string | null => value.trim() || null
