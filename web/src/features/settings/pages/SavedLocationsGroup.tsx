import { Link } from 'react-router'
import { useScheme } from '../../../theme/useScheme'
import { FIELD_ROW_PRESSABLE } from '../../../ui/form/FieldRow'
import { Group } from '../../../ui/form/Group'
import { useLocationSnapshot } from '../../recordings/useLocationSnapshot'
import { SAVED_LOCATIONS } from '../../recordings/recordingsCopy'
import {
  SAVED_LOCATIONS_EMPTY_HINT,
  SAVED_LOCATIONS_HELP,
  savedLocationRecordings,
} from '../settingsCopy'
import { useSavedLocations, type SavedLocationRow } from '../useSavedLocations'
import { savedLocationPath, SETTINGS_GROUPS } from '../settingsPaths'
import { PendingGroup } from '../PendingGroup'

const THUMBNAIL_PX = 56

/** A still map of the point, or an empty tile while it loads or when none can be made. */
function Thumbnail({ lat, lon }: { lat: number; lon: number }) {
  const scheme = useScheme()
  const src = useLocationSnapshot(
    { lat, lon },
    null,
    { width: THUMBNAIL_PX, height: THUMBNAIL_PX },
    scheme,
  )
  return (
    <span
      aria-hidden
      className="bg-field ph-no-capture size-14 shrink-0 overflow-hidden rounded-lg"
    >
      {src && <img src={src} alt="" className="ph-no-capture size-full object-cover" />}
    </span>
  )
}

function LocationItem({ row }: { row: SavedLocationRow }) {
  const { place } = row
  return (
    <Link to={savedLocationPath(place.id)} className={`${FIELD_ROW_PRESSABLE} py-2`}>
      <Thumbnail lat={place.lat} lon={place.lon} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="ph-no-capture truncate">{place.name}</span>
        {place.address && (
          <span className="t-secondary text-secondary ph-no-capture truncate">{place.address}</span>
        )}
        <span className="t-secondary text-secondary">
          {savedLocationRecordings(row.recordings)}
        </span>
      </span>
    </Link>
  )
}

/**
 * The Recordings page's saved locations: each with a map thumbnail, its name and address, and
 * how many recordings use it, by name. A row opens the location. With none, the group says how
 * one gets saved.
 */
export function SavedLocationsGroup() {
  const { rows } = useSavedLocations()
  if (rows === undefined) return <PendingGroup />
  return (
    <Group id={SETTINGS_GROUPS.savedLocations} header={SAVED_LOCATIONS} help={SAVED_LOCATIONS_HELP}>
      {rows.length === 0 ? (
        <p className="t-body text-secondary min-h-(--target) px-4 py-3">
          {SAVED_LOCATIONS_EMPTY_HINT}
        </p>
      ) : (
        rows.map((row) => <LocationItem key={row.place.id} row={row} />)
      )}
    </Group>
  )
}
