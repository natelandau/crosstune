import { ArrowUpRight } from 'lucide-react'
import { useLocationPermission } from '../../platform/locationPermission'
import { ActionRow } from '../../ui/form/ActionRow'
import { FIELD_ROW_PRESSABLE } from '../../ui/form/FieldRow'
import { Group } from '../../ui/form/Group'
import { LocationMap } from '../../ui/LocationMap'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import { mapsUrl, samePlace, type PlaceChoice } from './place'
import { LocationRow, PlaceSearch } from './LocationRows'
import {
  CLEAR_LOCATION,
  CURRENT_LOCATION,
  LOCATION_ACCESS_OFF,
  NAME_THIS_LOCATION,
  NEARBY_LOCATIONS,
  OPEN_IN_MAPS,
  RECENT_LOCATIONS,
  SAVED_LOCATIONS,
} from './recordingsCopy'
import { nearbyRows } from './stagedPlace'
import type { EditRecording } from './useEditRecording'
import { useNearbyPlaces } from './useNearbyPlaces'

/**
 * A recording's location page inside its edit sheet: a map of the spot, the location now with
 * its actions, the places near the recording, the saved and recent locations, a search, and the
 * access-off note. Every pick is held by the edit sheet until Save and returns to its form
 * through `onPicked`. The map and Nearby show only once MapKit answers, so the rest of the page
 * works without them.
 */
export function LocationPage({
  edit,
  onPicked,
  onName,
  settleMs,
}: {
  edit: EditRecording
  onPicked: () => void
  /** Opens the naming step. */
  onName: () => void
  settleMs?: number
}) {
  const analytics = useAnalytics()
  const locationOff = useLocationPermission() === 'denied'
  const at = edit.placePoint
  const venues = useNearbyPlaces(at && { lat: at.lat, lon: at.lon })
  const nearby = nearbyRows(at, edit.savedPlaces, venues)
  const linkedId = edit.linkedPlace?.id ?? null
  const isCurrent = (place: PlaceChoice) =>
    linkedId === null && edit.place !== null && samePlace(edit.place, place)
  const pick = (choose: () => void) => () => {
    choose()
    onPicked()
  }

  return (
    <div className="pb-4">
      {at && (
        <div className="pt-4">
          <LocationMap lat={at.lat} lon={at.lon} accuracyM={at.accuracyM} />
        </div>
      )}
      {edit.canClearPlace && (
        <Group header={CURRENT_LOCATION}>
          {edit.place && (
            <div className="flex min-h-(--target) flex-col justify-center px-4 py-2">
              <span className="t-body ph-no-capture">{edit.place.name}</span>
              {edit.placeAddress && (
                <span className="t-secondary text-secondary ph-no-capture">
                  {edit.placeAddress}
                </span>
              )}
            </div>
          )}
          {edit.canNamePlace && <ActionRow label={NAME_THIS_LOCATION} onPress={onName} />}
          {edit.mapsPoint && (
            <a
              href={mapsUrl(edit.mapsPoint, edit.place?.name ?? null)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => analytics.send('location_opened_in_maps', {})}
              className={`${FIELD_ROW_PRESSABLE} text-primary font-medium`}
            >
              <span className="min-w-0 flex-1">{OPEN_IN_MAPS}</span>
              <ArrowUpRight className="size-4 shrink-0" aria-hidden />
            </a>
          )}
          <ActionRow label={CLEAR_LOCATION} onPress={pick(edit.clearPlace)} />
        </Group>
      )}
      {nearby.length > 0 && (
        <Group header={NEARBY_LOCATIONS}>
          {nearby.map((row) =>
            row.kind === 'saved' ? (
              <LocationRow
                key={`saved-${row.place.id}`}
                name={row.place.name}
                detail={row.place.address}
                current={row.place.id === linkedId}
                onPress={pick(() => edit.pickNearby(row))}
              />
            ) : (
              <LocationRow
                key={`venue-${row.venue.applePlaceId ?? `${row.venue.lat},${row.venue.lon}`}`}
                name={row.venue.name}
                detail={row.venue.address}
                onPress={pick(() => edit.pickNearby(row))}
              />
            ),
          )}
        </Group>
      )}
      {edit.savedPlaces.length > 0 && (
        <Group header={SAVED_LOCATIONS}>
          {edit.savedPlaces.map((place) => (
            <LocationRow
              key={place.id}
              name={place.name}
              detail={place.address}
              current={place.id === linkedId}
              onPress={pick(() => edit.pickSaved(place))}
            />
          ))}
        </Group>
      )}
      {edit.recentPlaces.length > 0 && (
        <Group header={RECENT_LOCATIONS}>
          {edit.recentPlaces.map((place) => (
            <LocationRow
              key={`${place.name}|${place.lat},${place.lon}`}
              name={place.name}
              current={isCurrent(place)}
              onPress={pick(() => edit.pickRecent(place))}
            />
          ))}
        </Group>
      )}
      <PlaceSearch
        autoFocus={!edit.canClearPlace}
        settleMs={settleMs}
        onPick={(result) => pick(() => edit.pickSearch(result))()}
      />
      {locationOff && <p className="t-secondary text-secondary px-4 pt-6">{LOCATION_ACCESS_OFF}</p>}
    </div>
  )
}
