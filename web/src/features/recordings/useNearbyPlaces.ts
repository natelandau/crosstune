import * as Sentry from '@sentry/react'
import { useEffect, useState } from 'react'
import { PLACE_LIMITS } from '../../api/vocabulary'
import { byDistance, NEARBY_LIMIT, NEARBY_RADIUS_M } from '../../domain/placeDistances'
import type { MapKit, MapKitPlace } from '../../platform/mapkit'
import { useMapKitState } from '../../platform/useMapKit'

/** A place of interest near a recording, which picking saves as a location at its own point. */
export interface NearbyPlace {
  name: string
  /** The address line shown under the name: `street, town`, or the town with no street. */
  address: string | null
  lat: number
  lon: number
  applePlaceId: string | null
}

/** The kinds of place people play music in, as the Apple app searches. */
const VENUE_CATEGORIES = [
  'MusicVenue',
  'Nightlife',
  'Theater',
  'MovieTheater',
  'Cafe',
  'Restaurant',
  'Brewery',
  'Winery',
  'Distillery',
  'Library',
  'Museum',
  'School',
  'University',
  'ConventionCenter',
  'Fairground',
  'Park',
  'Campground',
  'Stadium',
] as const

interface Coordinate {
  lat: number
  lon: number
}

const text = (value: string | null | undefined) => value?.trim() || null

/**
 * The sub-locality when the mailing address names it, else the locality: Apple Maps sets every New
 * York borough's locality to New York and puts the borough, the town on its mail, in the
 * sub-locality. Elsewhere a sub-locality is a neighborhood the address leaves out.
 */
function mailingTown(place: MapKitPlace): string | null {
  const sub = text(place.subLocality)
  const address = place.formattedAddress
  if (!sub || !address) return text(place.locality)
  const named = address
    .split(/[,\n]/)
    .some((part) => part.trim().toLowerCase() === sub.toLowerCase())
  return named ? sub : text(place.locality)
}

/** A venue's address line as the Apple app and the server write it: `street, town`. */
export function venueAddress(place: MapKitPlace): string | null {
  const locality = mailingTown(place)
  const qualifier =
    place.countryCode === 'US' ? text(place.administrativeAreaCode) : text(place.country)
  const town = locality && (qualifier ? `${locality}, ${qualifier}` : locality)
  const line = [text(place.fullThoroughfare), town].filter(Boolean).join(', ')
  // Cut to the stored length, without the separator a cut can leave dangling.
  const capped = [...line]
    .slice(0, PLACE_LIMITS.address)
    .join('')
    .replace(/[,\s]+$/, '')
  return capped || null
}

async function search(mapkit: MapKit, at: Coordinate): Promise<NearbyPlace[]> {
  const categories = VENUE_CATEGORIES.map((name) => mapkit.PointOfInterestCategory[name]).filter(
    (category): category is string => !!category,
  )
  const places = await new Promise<MapKitPlace[]>((resolve, reject) => {
    new mapkit.PointsOfInterestSearch().search(
      (error, response) => (error ? reject(error) : resolve(response?.places ?? [])),
      {
        center: new mapkit.Coordinate(at.lat, at.lon),
        radius: NEARBY_RADIUS_M,
        pointOfInterestFilter: mapkit.PointOfInterestFilter.including(categories),
      },
    )
  })
  const venues = places.map((place) => ({
    name: place.name,
    address: venueAddress(place),
    lat: place.coordinate.latitude,
    lon: place.coordinate.longitude,
    applePlaceId: place.id ?? null,
  }))
  return byDistance(at, venues, NEARBY_RADIUS_M)
    .slice(0, NEARBY_LIMIT)
    .map(({ place }) => place)
}

/** Where a nearby lookup stands: out, failed or without MapKit, or answered (possibly empty). */
export type NearbyLookup =
  { status: 'loading' } | { status: 'unavailable' } | { status: 'found'; places: NearbyPlace[] }

/**
 * The venues within 150 m of a point, nearest first and at most 7, found with MapKit JS.
 * Loading while MapKit loads, the search is out, and with no point; unavailable when MapKit
 * cannot load or the search fails.
 */
export function useNearbyLookup(at: Coordinate | null): NearbyLookup {
  const { status, mapkit } = useMapKitState(at !== null)
  const [answer, setAnswer] = useState<{ key: string; places: NearbyPlace[] | null } | null>(null)
  const key = at ? `${at.lat},${at.lon}` : null
  const lat = at?.lat
  const lon = at?.lon

  useEffect(() => {
    if (!mapkit || lat === undefined || lon === undefined) return
    let current = true
    const answered = `${lat},${lon}`
    search(mapkit, { lat, lon }).then(
      (places) => current && setAnswer({ key: answered, places }),
      (error: unknown) => {
        Sentry.captureException(error, { level: 'warning' })
        if (current) setAnswer({ key: answered, places: null })
      },
    )
    return () => {
      current = false
    }
  }, [mapkit, lat, lon])

  if (key === null) return { status: 'loading' }
  if (status === 'unavailable') return { status: 'unavailable' }
  if (answer?.key !== key) return { status: 'loading' }
  return answer.places ? { status: 'found', places: answer.places } : { status: 'unavailable' }
}

/**
 * The venues within 150 m of a point, nearest first and at most 7, found with MapKit JS.
 * Null while loading, with no point, and when MapKit or the search fails.
 */
export function useNearbyPlaces(at: Coordinate | null): NearbyPlace[] | null {
  const lookup = useNearbyLookup(at)
  return lookup.status === 'found' ? lookup.places : null
}
