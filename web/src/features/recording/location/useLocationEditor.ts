import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useRef, useState } from 'react'
import type { PlaceHint, PlaceResult } from '../../../api/types'
import {
  editRecording,
  savedPlaceAt,
  savedPlaceFor,
  setCurrentPlace,
} from '../../../commands/places'
import { useDb } from '../../../db/DbProvider'
import { getCountryCenter } from '../../../db/meta'
import type { LocalPlace } from '../../../db/types'
import { useLocationPermission } from '../../../platform/locationPermission'
import { useLatest } from '../../../ui/useLatest'
import { useAnalytics } from '../../../usage/AnalyticsProvider'
import type { PlaceMethod } from '../../../usage/events'
import { devicePosition } from '../../capture/devicePosition'
import { useDevicePoint } from '../../capture/useDevicePoint'
import { livePlacesByName, recentPlaces, type PlaceChoice } from '../../recordings/place'
import {
  LocationState,
  madeBy,
  pendingPlace,
  searchDraft,
  type NearbyRow,
  type PlacePoint,
  type StagedPlace,
} from '../../recordings/stagedPlace'
import { useAllRecordings } from '../../recordings/useAllRecordings'
import type { RecordingView } from '../../recordings/useRecordings'
import type { PinSpot } from './DropPin'
import { pinStart } from './pinStart'
import { latestPlaced, searchHint } from './searchHint'

export interface LocationEditorState {
  /** The location to show and save, its saved location's name when linked to one. */
  place: PlaceChoice | null
  /** The line under the location's name: a saved location's address, when it says more. */
  placeAddress: string | null
  /** The point the map shows, with the fix's accuracy, named or not. */
  placePoint: PlacePoint | null
  /** Where Open in Maps goes: the saved location's own point when linked to one. */
  mapsPoint: PlacePoint | null
  /** The saved location the recording is linked to, as stored or as picked here. */
  linkedPlace: LocalPlace | null
  /** Whether the place can be saved under a typed name: precise, and not a saved location. */
  canNamePlace: boolean
  /** Whether the place is a saved location, renamed as Settings renames one. */
  canRenamePlace: boolean
  /**
   * Where Nearby looks and distances are measured from: the recording's point, else its saved
   * location's, else the device's.
   */
  center: PlaceHint | null
  /**
   * The list under the Nearby, Saved, and Recent switch. It opens once, on Nearby when there is
   * a center or one may still come from the device, else on Saved, and then changes only when
   * the musician picks another.
   */
  list: PlaceList
  chooseList: (list: PlaceList) => void
  /** Where a search ranks its results near. */
  hint: PlaceHint | null
  /** Whether the browser refuses this site the device's location. */
  locationOff: boolean
  /** True while the device's location is being read for Use current location. */
  locating: boolean
  /** The last press of Use current location got no fix, and no pick has come since. */
  noFix: boolean
  /** Reads the device's location and picks it, named by the server once saved. */
  pickCurrentLocation: () => void
  /** Picks a place used before. */
  pickRecent: (place: PlaceChoice) => void
  /** Picks a search result, which saves its venue or street address as a location. */
  pickSearch: (result: PlaceResult) => void
  /** Links a place near the recording; a venue not yet saved is saved at its own point. */
  pickNearby: (row: NearbyRow) => void
  /**
   * Links a saved location. From a list the recording keeps its own coordinates; while naming,
   * it moves to the point picked here, as the name would.
   */
  pickSaved: (place: LocalPlace, options?: { whileNaming?: boolean }) => void
  /**
   * Picks a dropped pin's spot by hand, named by its address; a typed name also saves a location
   * there and links the recording to it.
   */
  pickPin: (spot: PinSpot) => void
  /** Where the pin drop opens, given where the typed search's results are; null for the world. */
  pinStart: (searchArea: PlaceHint | null) => PlaceHint | null
  /** Saves `name` as a new location at the recording's point, linking it alone. */
  nameLocation: (name: string) => void
  clearPlace: () => void
  /** The places on the musician's recordings, this one's included, most recent first. Built on
   * the first call, since only the Recent list reads them. */
  recentPlaces: () => PlaceChoice[]
  /** The live saved locations, by name. */
  savedPlaces: LocalPlace[]
  /** Whether the pick differs from the recording as stored. */
  changed: boolean
  /**
   * Writes the pick, if it changed anything, and reports how it was chosen. A `named` place is
   * saved first, as `nameLocation` saves it.
   */
  save: (named?: string) => Promise<void>
}

export type PlaceList = 'nearby' | 'saved' | 'recent'

/**
 * A recording's location as the location editor picks it, held until `save`. A place left alone
 * keeps its accuracy; a place picked by hand has none, and the device's location keeps its own.
 */
export function useLocationEditor(view: RecordingView): LocationEditorState {
  const db = useDb()
  const analytics = useAnalytics()
  const permission = useLocationPermission()
  // The location picked or cleared here, null while the recording's own is kept.
  const [picked, setPicked] = useState<StagedPlace | null>(null)
  const [placeMethod, setPlaceMethod] = useState<PlaceMethod | null>(null)
  const [locating, setLocating] = useState(false)
  const [noFix, setNoFix] = useState(false)
  // Counts picks, so a fix that arrives after a later pick never replaces it.
  const picks = useRef(0)
  const recordings = useAllRecordings()
  // Followed so a rename or a delete on another device shows; undefined until read.
  const places = useLiveQuery(() => db.places.toArray(), [db])
  const savedPlaces = useMemo(() => livePlacesByName(places ?? []), [places])
  const savedPlacesRef = useLatest(savedPlaces)
  const placesBefore = useMemo(() => {
    let built: PlaceChoice[] | undefined
    return () =>
      (built ??= recentPlaces(recordings ?? [], new Map(savedPlaces.map((p) => [p.id, p]))))
  }, [recordings, savedPlaces])

  // The recording as it is now, so a name or a link that syncs in while the editor is open shows.
  const id = view.recording.id
  const current = recordings?.find((r) => r.id === id) ?? view.recording
  const location = useMemo(
    () => new LocationState(picked, current, places),
    [picked, current, places],
  )
  // Its own point, else its saved location's, as the map shows it.
  const stored = location.storedPoint
  const own = stored && { lat: stored.lat, lon: stored.lon }
  // A linked recording's point may still come from its saved location, once they are read.
  const ownMayCome = own === null && current.place_id != null && places === undefined
  const locationOn = permission === 'granted'

  // Only a recording with no point of its own looks to the device, and only with access on, so
  // opening the editor never asks for location.
  const device = useDevicePoint(own === null && !ownMayCome && locationOn)
  const shownDevice = locationOn ? device.point : null
  const center = own ?? shownDevice

  const [chosenList, chooseList] = useState<PlaceList | null>(null)
  const [openingList, setOpeningList] = useState<PlaceList | null>(null)
  const centerMayCome =
    own === null && (ownMayCome || permission === null || (locationOn && device.reading))
  const decided: PlaceList | null = center ? 'nearby' : centerMayCome ? null : 'saved'
  // Decided once, so a fix that lands later never moves the musician off the list they see.
  if (openingList === null && decided !== null) setOpeningList(decided)
  const list = chosenList ?? openingList ?? decided ?? 'nearby'

  const latest = useMemo(() => latestPlaced(recordings ?? []), [recordings])
  const countryCenter = useLiveQuery(() => getCountryCenter(db), [db]) ?? null
  const hint = searchHint({ stored: own, device: shownDevice, latestPlaced: latest })

  const stage = (next: StagedPlace, method: PlaceMethod | null) => {
    picks.current += 1
    setNoFix(false)
    setPicked(next)
    setPlaceMethod(method)
  }

  const pendingPick = () => pendingPlace(location.staged)

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

  const namedPick = (name: string): StagedPlace | null => {
    const draft = location.namedDraft(name)
    return draft && { kind: 'create', draft, made: 'custom', over: pendingPick() }
  }

  const nameLocation = (name: string) => {
    const named = namedPick(name)
    if (named) stage(named, 'saved')
  }

  const pickPin = ({ lat, lon, name, address, savedName }: PinSpot) => {
    const over = { name, lat, lon }
    if (!savedName) {
      stage({ kind: 'search', place: over, saving: null }, 'pin')
      return
    }
    const draft = {
      name: savedName,
      address: address ?? (name || null),
      lat,
      lon,
      applePlaceId: null,
    }
    stage({ kind: 'create', draft, made: 'custom', over }, 'pin')
  }

  const pickCurrentLocation = () => {
    setLocating(true)
    setNoFix(false)
    const asked = picks.current
    void devicePosition(navigator.geolocation).then((at) => {
      setLocating(false)
      if (picks.current !== asked) return
      if (!at) {
        setNoFix(true)
        return
      }
      const saved = savedPlaceAt(savedPlacesRef.current, at) ?? null
      stage({ kind: 'device', point: at, saved }, 'current_location')
    })
  }

  const save = async (name?: string) => {
    const named = name === undefined ? null : namedPick(name)
    const saving = named ? new LocationState(named, current, places) : location
    if (!saving.changed) return
    const staged = saving.staged
    const replaced = saving.hadPlace
    if (staged?.kind === 'device') {
      await setCurrentPlace(db, id, staged.point)
      analytics.send('recording_place_set', {
        method: 'current_location',
        recording_id: id,
        replaced,
      })
      return
    }
    const handPatch = saving.handPatch()
    const method = saving.method(named ? 'saved' : placeMethod)
    const link = saving.link(method)
    const made = madeBy(staged)
    const created = await editRecording(db, id, { ...handPatch }, link)
    if (staged?.kind === 'cleared') {
      analytics.send('recording_place_cleared', { recording_id: id })
    } else if (staged && method) {
      analytics.send('recording_place_set', { method, recording_id: id, replaced })
    }
    if (created && made) analytics.send('saved_location_created', { method: made })
  }

  return {
    place: location.place,
    placeAddress: location.address,
    placePoint: location.point,
    mapsPoint: location.mapsPoint,
    linkedPlace: location.linked,
    canNamePlace: location.canName,
    canRenamePlace: location.canRename,
    center,
    list,
    chooseList,
    hint,
    locationOff: permission === 'denied',
    locating,
    noFix,
    pickCurrentLocation,
    pickRecent: (place) => stage({ kind: 'place', place }, 'suggestion'),
    pickSearch,
    pickNearby,
    pickSaved,
    pickPin,
    pinStart: (searchArea) =>
      pinStart({
        stored: location.storedPoint,
        device: shownDevice,
        searchArea,
        latestPlaced: latest,
        countryCenter,
      }),
    nameLocation,
    clearPlace: () => stage({ kind: 'cleared' }, null),
    recentPlaces: placesBefore,
    savedPlaces,
    changed: location.changed,
    save,
  }
}
