import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import type { PlaceResult } from '../../api/types'
import type { PlaceMethod } from '../../usage/events'
import { recordingOrigin } from '../../usage/origin'
import { editRecording, savedPlaceFor } from '../../commands/places'
import { useDb } from '../../db/DbProvider'
import { isRecordingPrecision, type LocalPlace } from '../../db/types'
import { compareNames } from '../../text/collate'
import { isFullYear, narrowedParts, NO_DATE, sameParts, type DateParts } from '../../ui/partialDate'
import { useAction } from '../../ui/useAction'
import { useSheetSession } from '../../ui/useSheetSession'
import { recordedTime } from '../../text/format'
import { recordedAtNote } from './recordingCopy'
import { recentPlaces, recordingPlayers, type PlaceChoice } from './place'
import {
  LocationState,
  madeBy,
  pendingPlace,
  searchDraft,
  type NearbyRow,
  type PlacePoint,
  type StagedPlace,
} from './stagedPlace'
import { datePatch, partsOf, type StoredDate } from './recordedDateParts'
import type { RecordingView } from './useRecordings'

/** A page the edit sheet shows instead of its form. */
export type EditRecordingPage = 'form' | 'location' | 'name'

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
  /** The recording's exact time, shown only while its date parts are left alone. */
  timeNote: string | null
  dateError: string | null
  notes: string
  setNotes: (notes: string) => void
  players: string
  setPlayers: (players: string) => void
  /** The players on the musician's recordings, to suggest. */
  playerSuggestions: string[]
  /** The location to show and save, its saved location's name when linked to one. */
  place: PlaceChoice | null
  /** The line under the location's name: a saved location's address, when it says more. */
  placeAddress: string | null
  /** The point the map shows, with the recording's accuracy, named or not. */
  placePoint: PlacePoint | null
  /** Where Open in Maps goes: the saved location's own point when linked to one. */
  mapsPoint: PlacePoint | null
  /** The saved location the recording is linked to, as stored or as picked here. */
  linkedPlace: LocalPlace | null
  /** Whether Clear has a place to clear: a named one, or coordinates with no name yet. */
  canClearPlace: boolean
  /** Whether the point is precise enough to save under a typed name. */
  canNamePlace: boolean
  /** Picks a place used before. */
  pickRecent: (place: PlaceChoice) => void
  /** Picks a search result, which saves its venue or street address as a location on Save. */
  pickSearch: (result: PlaceResult) => void
  /** Links a place near the recording; a venue not yet saved is saved at its own point on Save. */
  pickNearby: (row: NearbyRow) => void
  /**
   * Links a saved location. From the saved list the recording keeps its own coordinates; while
   * naming, it moves to the point picked here, as the name would.
   */
  pickSaved: (place: LocalPlace, options?: { whileNaming?: boolean }) => void
  /** Saves `name` as a new location at the recording's point on Save, linking it alone. */
  nameLocation: (name: string) => void
  clearPlace: () => void
  /** The places on the musician's recordings, this one's included, most recent first. */
  recentPlaces: PlaceChoice[]
  /** The live saved locations, by name. */
  savedPlaces: LocalPlace[]
  /** The page the sheet shows: its form, the location page, or naming the location. */
  page: EditRecordingPage
  showPage: (page: EditRecordingPage) => void
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
 * year, optionally narrowed to a month and a day; a recording's exact time survives only while its
 * date parts are left alone. A place left alone keeps its accuracy. `view` is null for a closed
 * sheet; the parent nulls it from `onClose`.
 */
export function useEditRecording(
  view: RecordingView | null,
  {
    onClose,
    onDateError,
    initialPage = 'form',
  }: {
    onClose: () => void
    /** Runs when a save is refused for its date, to move focus to the year. */
    onDateError?: () => void
    /** The page the sheet opens on. */
    initialPage?: EditRecordingPage
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
  // The location picked or cleared here, null while the recording's own is kept.
  const [picked, setPicked] = useState<StagedPlace | null>(null)
  const [placeMethod, setPlaceMethod] = useState<PlaceMethod | null>(null)
  const [page, setPage] = useState<EditRecordingPage>('form')
  const showing = view !== null
  // Read only while the sheet shows, so a closed sheet never re-reads on every recording write.
  const recordings = useLiveQuery(() => (showing ? db.recordings.toArray() : []), [db, showing])
  // Followed so a rename or a delete on another device shows; undefined until read.
  const places = useLiveQuery(() => (showing ? db.places.toArray() : []), [db, showing])
  const viewId = view?.recording.id ?? null
  const playerSuggestions = useMemo(() => recordingPlayers(recordings ?? []), [recordings])
  const savedPlaces = useMemo(
    () =>
      (places ?? [])
        .filter((place) => !place.deleted_at)
        .sort((a, b) => compareNames(a.name, b.name)),
    [places],
  )
  const placesBefore = useMemo(
    () => recentPlaces(recordings ?? [], new Map(savedPlaces.map((p) => [p.id, p]))),
    [recordings, savedPlaces],
  )
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
      setPicked(null)
      setPlaceMethod(null)
      setPage(initialPage)
      clear()
    },
    onClose,
  })

  // The recording as it is now, so a name or a link that syncs in while the sheet is open shows.
  const liveRow = viewId ? recordings?.find((r) => r.id === viewId) : undefined
  const location = view ? new LocationState(picked, liveRow ?? view.recording, places) : null
  const dateUnchanged = sameParts(parts, openedParts)
  const placeChanged = location?.changed ?? false
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

  const stage = (next: StagedPlace, method: PlaceMethod | null) => {
    setPicked(next)
    setPlaceMethod(method)
    clear()
  }

  const pendingPick = () => pendingPlace(location?.staged ?? null)

  const pickSearch = (result: PlaceResult) => {
    const place = { name: result.name, lat: result.lat, lon: result.lon }
    const saving = searchDraft(result)
    const existing = saving ? savedPlaceFor(savedPlaces, saving) : undefined
    stage(
      existing
        ? { kind: 'link', place: existing, over: place, saving }
        : { kind: 'search', place, saving },
      'search',
    )
  }

  const pickNearby = (row: NearbyRow) => {
    const over = pendingPick()
    if (row.kind === 'saved') {
      stage({ kind: 'link', place: row.place, over }, 'nearby')
      return
    }
    const { name, address, lat, lon, applePlaceId } = row.venue
    stage(
      { kind: 'create', draft: { name, address, lat, lon, applePlaceId }, made: 'nearby', over },
      'nearby',
    )
  }

  const pickSaved = (place: LocalPlace, { whileNaming = false } = {}) =>
    stage({ kind: 'link', place, over: whileNaming ? pendingPick() : null }, 'saved')

  const nameLocation = (name: string) => {
    const draft = location?.namedDraft(name)
    if (draft) stage({ kind: 'create', draft, made: 'custom', over: pendingPick() }, 'saved')
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
    const handPatch = location?.handPatch() ?? null
    const method = location?.method(placeMethod) ?? placeMethod
    const link = location?.link(method) ?? null
    const staged = placeChanged ? (location?.staged ?? null) : null
    const replaced = location?.hadPlace ?? false
    const made = madeBy(staged)
    sheet.beginSave()
    runThen(async () => {
      const created = await editRecording(
        db,
        view.recording.id,
        {
          label,
          ...date,
          ...(notes === openedNotes ? {} : { notes: blankToNull(notes) }),
          ...(players === openedPlayers ? {} : { players: blankToNull(players) }),
          ...handPatch,
        },
        link,
      ).catch(sheet.saveFailed)
      const recordingId = view.recording.id
      if (label !== (view.recording.label ?? null)) {
        analytics.send('recording_renamed', {
          origin: recordingOrigin(view.recording),
          recording_id: recordingId,
        })
      }
      if (staged?.kind === 'cleared') {
        analytics.send('recording_place_cleared', { recording_id: recordingId })
      } else if (staged && method) {
        analytics.send('recording_place_set', {
          method,
          recording_id: recordingId,
          replaced,
        })
      }
      if (created && made) analytics.send('saved_location_created', { method: made })
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
    place: location?.place ?? null,
    placeAddress: location?.address ?? null,
    placePoint: location?.point ?? null,
    mapsPoint: location?.mapsPoint ?? null,
    linkedPlace: location?.linked ?? null,
    canClearPlace: location?.point != null,
    canNamePlace: location?.canName ?? false,
    pickRecent: (place) => stage({ kind: 'place', place }, 'suggestion'),
    pickSearch,
    pickNearby,
    pickSaved,
    nameLocation,
    clearPlace: () => stage({ kind: 'cleared' }, null),
    recentPlaces: placesBefore,
    savedPlaces,
    page,
    showPage: setPage,
    error,
    pending,
    dirty:
      name !== openedName ||
      !dateUnchanged ||
      notes !== openedNotes ||
      players !== openedPlayers ||
      placeChanged,
    save,
    close: sheet.close,
    dismissed: sheet.dismissed,
  }
}

const blankToNull = (value: string): string | null => value.trim() || null
