import type { LocalPlace, LocalRecording } from '../../db/types'
import { compareNames } from '../../text/collate'
import { tally } from '../tune/tuneTypes'

/** A place picked by hand: its name and full-precision coordinates, with no accuracy. */
export type PlaceChoice = { name: string; lat: number; lon: number }

/** A recording's place, or null unless it is named: a client shows only a named place. */
export function recordingPlace(r: LocalRecording): PlaceChoice | null {
  if (!r.place_name || r.place_lat == null || r.place_lon == null) return null
  return { name: r.place_name, lat: r.place_lat, lon: r.place_lon }
}

export function samePlace(a: PlaceChoice | null, b: PlaceChoice | null): boolean {
  if (a === null || b === null) return a === b
  return a.name === b.name && a.lat === b.lat && a.lon === b.lon
}

const live = (recordings: readonly LocalRecording[]) => recordings.filter((r) => !r.deleted_at)

/**
 * The places on the musician's recordings, each once, most recently added first. One name at
 * two spots stays twice, since a town's name can repeat across states. A recording linked to
 * one of the live `saved` locations is left out, since that location is offered on its own.
 */
export function recentPlaces(
  recordings: LocalRecording[],
  saved: ReadonlyMap<string, LocalPlace> = new Map(),
): PlaceChoice[] {
  const places: PlaceChoice[] = []
  const newestFirst = live(recordings).sort((a, b) =>
    a.added_at < b.added_at ? 1 : a.added_at > b.added_at ? -1 : 0,
  )
  for (const r of newestFirst) {
    const linked = r.place_id ? saved.get(r.place_id) : undefined
    if (linked && !linked.deleted_at) continue
    const place = recordingPlace(r)
    if (place && !places.some((p) => samePlace(p, place))) places.push(place)
  }
  return places
}

/** The players on the musician's recordings, each once whatever its case, by name. */
export function recordingPlayers(recordings: LocalRecording[]): string[] {
  return [...tally(live(recordings).map((r) => r.players)).keys()].sort(compareNames)
}

/**
 * The name to show for a recording's place: its saved location's name while that location is
 * live, else the name the recording carries itself, null when it has neither.
 */
export function shownPlaceName(
  r: LocalRecording,
  placesById: ReadonlyMap<string, LocalPlace>,
): string | null {
  const saved = r.place_id ? placesById.get(r.place_id) : undefined
  if (saved && !saved.deleted_at) return saved.name
  return r.place_name ?? null
}

/** An Apple Maps link to a point, labeled with the location's name when it has one. */
export function mapsUrl(at: { lat: number; lon: number }, name: string | null): string {
  const url = new URL('https://maps.apple.com/')
  url.searchParams.set('ll', `${at.lat},${at.lon}`)
  if (name) url.searchParams.set('q', name)
  return url.toString()
}
