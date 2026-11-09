import { PLACE_LIMITS } from '../../api/vocabulary'
import type { LocalPlace } from '../../db/types'
import { Group } from '../../ui/form/Group'
import { TextField } from '../../ui/form/TextField'
import { LocationList, LocationRow } from './LocationRows'
import { LOCATION_NAME_LABEL, SAVED_HERE } from './recordingsCopy'

/**
 * A location's name: the saved locations offered in its place first, so reusing one is one
 * press, then a name field with `help` under it, or `error` in its place.
 */
export function NameLocationForm({
  candidates = [],
  name,
  help,
  error,
  onNameChange,
  onPick,
  onSubmit,
}: {
  candidates?: LocalPlace[]
  name: string
  help: string
  error?: string
  onNameChange: (name: string) => void
  onPick?: (place: LocalPlace) => void
  onSubmit: () => void
}) {
  return (
    <form
      noValidate
      className="pb-4"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      {candidates.length > 0 && (
        <LocationList label={SAVED_HERE} showLabel>
          {candidates.map((place) => (
            <LocationRow
              key={place.id}
              id={place.id}
              name={place.name}
              detail={place.address}
              onPress={() => onPick?.(place)}
            />
          ))}
        </LocationList>
      )}
      <Group footer={help} error={error}>
        <TextField
          standalone
          label={LOCATION_NAME_LABEL}
          value={name}
          maxLength={PLACE_LIMITS.name}
          enterKeyHint="done"
          autoFocus={candidates.length === 0}
          onChange={onNameChange}
        />
      </Group>
    </form>
  )
}
