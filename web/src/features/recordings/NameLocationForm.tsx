import { PLACE_LIMITS } from '../../api/vocabulary'
import type { LocalPlace } from '../../db/types'
import { Group } from '../../ui/form/Group'
import { TextField } from '../../ui/form/TextField'
import { LocationRow } from './LocationRows'
import { LOCATION_NAME_LABEL, NAME_LOCATION_HELP, SAVED_HERE } from './recordingsCopy'

/**
 * Names the recording's point: the saved locations already within 30 m first, so reusing one is one
 * press, then a name field that saves a new one. Nothing is written until the edit sheet saves.
 */
export function NameLocationForm({
  candidates,
  name,
  onNameChange,
  onPick,
  onSubmit,
}: {
  candidates: LocalPlace[]
  name: string
  onNameChange: (name: string) => void
  onPick: (place: LocalPlace) => void
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
        <Group header={SAVED_HERE}>
          {candidates.map((place) => (
            <LocationRow
              key={place.id}
              name={place.name}
              detail={place.address}
              onPress={() => onPick(place)}
            />
          ))}
        </Group>
      )}
      <Group footer={NAME_LOCATION_HELP}>
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
