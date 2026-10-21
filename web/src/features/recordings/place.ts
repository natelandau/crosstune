import type { LocalRecording } from '../../db/types'
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
 * two spots stays twice, since a town's name can repeat across states.
 */
export function recentPlaces(recordings: LocalRecording[]): PlaceChoice[] {
  const places: PlaceChoice[] = []
  const newestFirst = live(recordings).sort((a, b) =>
    a.added_at < b.added_at ? 1 : a.added_at > b.added_at ? -1 : 0,
  )
  for (const r of newestFirst) {
    const place = recordingPlace(r)
    if (place && !places.some((p) => samePlace(p, place))) places.push(place)
  }
  return places
}

/** The players on the musician's recordings, each once whatever its case, by name. */
export function recordingPlayers(recordings: LocalRecording[]): string[] {
  return [...tally(live(recordings).map((r) => r.players)).keys()].sort(compareNames)
}

/** The players and the named place, for a line under a recording's title; empty ones left out. */
export function recordingCredits(r: LocalRecording): string[] {
  return [r.players, recordingPlace(r)?.name].filter((part): part is string => !!part)
}
