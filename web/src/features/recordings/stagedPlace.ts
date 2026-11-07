import type { PlaceResult } from '../../api/types'
import {
  savedPlaceFor,
  type PickedPoint,
  type PlaceLink,
  type SavedPlaceDraft,
} from '../../commands/places'
import type { LocalPlace, LocalRecording } from '../../db/types'
import {
  byDistance,
  isPrecise,
  MATCH_RADIUS_M,
  NEARBY_LIMIT,
  NEARBY_RADIUS_M,
} from '../../domain/placeDistances'
import type { PlaceMethod, SavedLocationMethod } from '../../usage/events'
import { recordingPlace, samePlace, shownPlaceName, type PlaceChoice } from './place'
import type { NearbyPlace } from './useNearbyPlaces'

/** A location picked in the location editor, held until the editor saves. */
export type StagedPlace =
  /** No location, coordinates and all. */
  | { kind: 'cleared' }
  /** A place used before, linked to no saved location. */
  | { kind: 'place'; place: PlaceChoice }
  /** A search result, with the saved location it makes when it is a venue or a street address. */
  | { kind: 'search'; place: PlaceChoice; saving: SavedPlaceDraft | null }
  /**
   * A saved location that exists already, linked over the place picked before it, whose point
   * the recording moves to, or over the recording's own point when `over` is null.
   */
  | {
      kind: 'link'
      place: LocalPlace
      over: PlaceChoice | null
      /** The search result's own saved location, made should the linked one go. */
      saving?: SavedPlaceDraft | null
    }
  /** A saved location made on saving and then linked, with how it came to be, over as for a link. */
  | {
      kind: 'create'
      draft: SavedPlaceDraft
      made: SavedLocationMethod
      over: PlaceChoice | null
    }
  /** The device's fix, with its accuracy and the saved location it is at, named by the server. */
  | { kind: 'device'; point: PlacePoint; saved: LocalPlace | null }

/** A point with the fix's accuracy, null for a point picked by hand or a file's. */
export type PlacePoint = { lat: number; lon: number; accuracyM: number | null }

/** The place picked here whose point the recording moves to, null when it keeps its own. */
export function pendingPlace(staged: StagedPlace | null): PlaceChoice | null {
  switch (staged?.kind) {
    case 'place':
    case 'search':
      return staged.place
    case 'link':
    case 'create':
      return staged.over
    default:
      return null
  }
}

/** How the saved location a pick makes came to be, null when it makes none. */
export function madeBy(staged: StagedPlace | null): SavedLocationMethod | null {
  if (staged?.kind === 'search') return staged.saving ? 'search' : null
  if (staged?.kind === 'create') return staged.made
  return null
}

/** The saved location a search result makes: a venue or a street address does, a town none. */
export function searchDraft(result: PlaceResult): SavedPlaceDraft | null {
  const point = { lat: result.lat, lon: result.lon, applePlaceId: null }
  switch (result.kind) {
    case 'venue':
      return { name: result.title, address: result.address ?? null, ...point }
    case 'address':
      return { name: result.name, address: null, ...point }
    default:
      return null
  }
}

/** A place near the recording, a saved location or a venue not yet saved, and how far it is. */
export type NearbyRow =
  | { kind: 'saved'; place: LocalPlace; meters: number }
  | { kind: 'venue'; venue: NearbyPlace; meters: number }

/**
 * The saved locations within 150 m of the recording and the venues not saved by `savedPlaceFor`'s
 * rule, nearest first, at most 7 in all. Empty until the venue search answers, and when it fails.
 */
export function nearbyRows(
  center: { lat: number; lon: number } | null,
  saved: readonly LocalPlace[],
  venues: readonly NearbyPlace[] | null,
): NearbyRow[] {
  if (!center || !venues) return []
  const close = byDistance(center, saved, NEARBY_RADIUS_M)
  const unsaved = venues.filter((venue) => !savedPlaceFor(saved, venue))
  return [
    ...close.map(({ place, meters }): NearbyRow => ({ kind: 'saved', place, meters })),
    ...byDistance(center, unsaved, Infinity).map(({ place: venue, meters }): NearbyRow => ({
      kind: 'venue',
      venue,
      meters,
    })),
  ]
    .sort((a, b) => a.meters - b.meters)
    .slice(0, NEARBY_LIMIT)
}

/** The saved locations within 30 m of the point, nearest first, offered before a new name. */
export function namingCandidates(
  at: { lat: number; lon: number } | null,
  saved: readonly LocalPlace[],
): LocalPlace[] {
  return at ? byDistance(at, saved, MATCH_RADIUS_M).map(({ place }) => place) : []
}

const point = (place: { lat: number; lon: number }): PlacePoint => ({
  lat: place.lat,
  lon: place.lon,
  accuracyM: null,
})

/**
 * What a location edit shows and saves for a recording, from the pick held for saving
 * and the recording and saved locations as they are now.
 */
export class LocationState {
  /** The pick held for saving, with a link to a saved location deleted meanwhile fallen back. */
  readonly staged: StagedPlace | null
  private readonly byId: ReadonlyMap<string, LocalPlace>
  private readonly fellBack: boolean

  constructor(
    picked: StagedPlace | null,
    private readonly current: LocalRecording,
    /** The live saved locations, undefined until read. */
    private readonly places: readonly LocalPlace[] | undefined,
  ) {
    this.byId = new Map((places ?? []).filter((p) => !p.deleted_at).map((p) => [p.id, p]))
    // A link to a saved location deleted meanwhile falls back to the place it was picked over,
    // with the location that search pick makes, or to no pick, so the recording's own location
    // shows and saves.
    this.fellBack =
      picked?.kind === 'link' && places !== undefined && !this.byId.has(picked.place.id)
    this.staged =
      this.fellBack && picked?.kind === 'link'
        ? picked.over
          ? { kind: 'search', place: picked.over, saving: picked.saving ?? null }
          : null
        : picked
  }

  /** How the location a save writes was chosen: a fallen-back link writes the search pick under it. */
  method(picked: PlaceMethod | null): PlaceMethod | null {
    return this.fellBack && this.staged?.kind === 'search' ? 'search' : picked
  }

  /**
   * Where the recording will be once saved, with the fix's accuracy: the point picked here, else
   * its own.
   */
  get recordingPoint(): PlacePoint | null {
    if (this.staged?.kind === 'device') return this.staged.point
    const pending = pendingPlace(this.staged)
    if (pending) return point(pending)
    return this.ownPoint
  }

  private get ownPoint(): PlacePoint | null {
    const { place_lat: lat, place_lon: lon, place_accuracy_m: accuracyM } = this.current
    return lat != null && lon != null ? { lat, lon, accuracyM: accuracyM ?? null } : null
  }

  /** The saved location the recording is linked to, as stored or as picked here, read live. */
  get linked(): LocalPlace | null {
    const staged = this.staged
    if (staged === null) {
      const id = this.current.place_id
      return id ? (this.byId.get(id) ?? null) : null
    }
    if (staged.kind === 'link') return this.byId.get(staged.place.id) ?? staged.place
    if (staged.kind === 'device')
      return staged.saved ? (this.byId.get(staged.saved.id) ?? null) : null
    return null
  }

  /**
   * The recording's point as stored, with its accuracy: its own, else its saved location's. Null
   * with neither.
   */
  get storedPoint(): PlacePoint | null {
    const id = this.current.place_id
    const linked = id ? this.byId.get(id) : undefined
    return this.ownPoint ?? (linked ? point(linked) : null)
  }

  /**
   * The location to show and save: its name and the point it marks. A linked recording
   * shows its saved location's name once the saved locations are read, so its own name never
   * flashes first.
   */
  get place(): PlaceChoice | null {
    const staged = this.staged
    switch (staged?.kind) {
      case undefined: {
        const shown = this.storedPoint
        if (!shown || (this.current.place_id && this.places === undefined)) return null
        const name = shownPlaceName(this.current, this.byId)
        return name ? { name, lat: shown.lat, lon: shown.lon } : null
      }
      case 'cleared':
        return null
      case 'place':
      case 'search':
        return staged.place
      case 'link': {
        const live = this.linked ?? staged.place
        const at = this.recordingPoint
        return { name: live.name, ...(at ? { lat: at.lat, lon: at.lon } : point(live)) }
      }
      case 'create': {
        const at = this.recordingPoint
        return {
          name: staged.draft.name,
          ...(at ? { lat: at.lat, lon: at.lon } : point(staged.draft)),
        }
      }
      case 'device': {
        const saved = this.linked
        return saved ? { name: saved.name, lat: staged.point.lat, lon: staged.point.lon } : null
      }
    }
  }

  /** The line under the location's name: a saved location's address, when it says more. */
  get address(): string | null {
    const kind = this.staged?.kind
    const address =
      kind === undefined || kind === 'link' || kind === 'device'
        ? (this.linked?.address ?? null)
        : this.staged?.kind === 'create'
          ? this.staged.draft.address
          : null
    return address === this.place?.name ? null : address
  }

  /**
   * The point the map shows, with the recording's accuracy, named or not: the recording's own,
   * else its saved location's. Null with no place.
   */
  get point(): PlacePoint | null {
    const staged = this.staged
    switch (staged?.kind) {
      case undefined:
        return this.storedPoint
      case 'cleared':
        return null
      case 'place':
      case 'search':
        return point(staged.place)
      case 'link':
        return this.recordingPoint ?? point(staged.place)
      case 'create':
        return this.recordingPoint ?? point(staged.draft)
      case 'device':
        return staged.point
    }
  }

  /**
   * Where Open in Maps goes: the saved location's own point when linked to one, else the
   * recording's.
   */
  get mapsPoint(): PlacePoint | null {
    const linked = this.linked
    if (linked) return point(linked)
    if (this.staged?.kind === 'create') return point(this.staged.draft)
    return this.point
  }

  /**
   * Whether the place can be saved under a typed name: not a saved location already, which is
   * renamed where saved locations are, and precise enough that a vague fix never becomes a saved
   * location that pulls in its neighbors.
   */
  get canName(): boolean {
    // A fix not yet saved has no name or street of its own to save a location with.
    if (this.staged?.kind === 'device') return false
    if (this.linked || this.staged?.kind === 'create') return false
    const at = this.point
    return at !== null && isPrecise(at.accuracyM)
  }

  /** Whether the place is a saved location, which is renamed rather than named. */
  get canRename(): boolean {
    return this.linked !== null
  }

  /**
   * The street address line of where the recording will be, null when it is not known: a name the
   * server gave the recording's own fix, or the address of the saved location or search result
   * picked. A name picked by hand, such as `Venue, street, town`, is not one.
   */
  get streetLine(): string | null {
    const staged = this.staged
    switch (staged?.kind) {
      case undefined: {
        const { place_origin: origin, place_name: own } = this.current
        if ((origin === 'device' || origin === 'file') && own) return own
        return this.linked?.address ?? null
      }
      case 'search': {
        const saving = staged.saving
        // A street address saves under its own address line, with no address under it.
        if (!saving) return null
        return saving.address ?? (saving.name === staged.place.name ? saving.name : null)
      }
      case 'link':
        return (this.linked ?? staged.place).address ?? null
      case 'create':
        return staged.draft.address
      case 'device':
        return this.linked?.address ?? null
      default:
        return null
    }
  }

  /** Whether the pick differs from the recording as stored. */
  get changed(): boolean {
    const staged = this.staged
    const stored = this.current
    switch (staged?.kind) {
      case undefined:
        return false
      case 'cleared':
        return (
          stored.place_lat != null ||
          stored.place_lon != null ||
          stored.place_name != null ||
          stored.place_id != null
        )
      case 'place':
        return stored.place_id != null || !samePlace(recordingPlace(stored), staged.place)
      case 'link':
        return staged.over !== null || stored.place_id !== staged.place.id
      default:
        return true
    }
  }

  /** Whether the recording has a location for a pick to replace, as it is now. */
  get hadPlace(): boolean {
    return recordingPlace(this.current) !== null || this.current.place_id != null
  }

  /** The saved location this recording is named for: its typed name at the point it will be. */
  namedDraft(name: string): SavedPlaceDraft | null {
    const trimmed = name.trim()
    const at = this.point
    if (!trimmed || !at) return null
    const street = this.streetLine
    return {
      name: trimmed,
      address: street === trimmed ? null : street,
      lat: at.lat,
      lon: at.lon,
      applePlaceId: null,
    }
  }

  /** The hand edit a save writes for the pick, or null to leave the place alone. */
  handPatch(): {
    place_name: string | null
    place_lat: number | null
    place_lon: number | null
  } | null {
    const staged = this.changed ? this.staged : null
    if (staged?.kind === 'cleared') return { place_name: null, place_lat: null, place_lon: null }
    if (staged?.kind === 'place') {
      const { name, lat, lon } = staged.place
      return { place_name: name, place_lat: lat, place_lon: lon }
    }
    return null
  }

  /** The link a save writes for the pick, null for none. */
  link(method: PlaceMethod | null): PlaceLink | null {
    const staged = this.changed ? this.staged : null
    const how = method === 'nearby' ? 'nearby' : 'saved'
    const picked = (place: PlaceChoice | null): PickedPoint | null =>
      place && { name: place.name, lat: place.lat, lon: place.lon }
    switch (staged?.kind) {
      case 'search':
        return { kind: 'search', place: picked(staged.place)!, saving: staged.saving }
      case 'link':
        return { kind: 'link', method: how, placeId: staged.place.id, over: picked(staged.over) }
      case 'create':
        return { kind: 'create', method: how, draft: staged.draft, over: picked(staged.over) }
      default:
        return null
    }
  }
}
