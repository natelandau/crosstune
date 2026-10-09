import { TUNE_LIMITS, STATUSES } from '../../../api/vocabulary'
import { GENRES, STATUS_LABELS } from '../../../constants'
import { Group } from '../../../ui/form/Group'
import { Picker } from '../../../ui/form/Picker'
import { SuggestField } from '../../../ui/form/SuggestField'
import { NEW_TUNE_GENRE_LABEL, NEW_TUNE_STATUS_LABEL, NEW_TUNES_HELP } from '../newTunes'
import { useNewTuneSettings } from '../useNewTuneSettings'

const STATUS_OPTIONS = STATUSES.map((id) => ({ id, label: STATUS_LABELS[id] }))

/** The status and genre every new tune starts with. */
export function NewTunesPage() {
  const { defaults, setGenre, setStatus, genreError, statusError } = useNewTuneSettings()
  if (!defaults) return null
  return (
    <Group help={NEW_TUNES_HELP} error={statusError ?? genreError ?? undefined}>
      <Picker
        label={NEW_TUNE_STATUS_LABEL}
        value={defaults.status}
        options={STATUS_OPTIONS}
        onChange={(id) => {
          const next = STATUSES.find((status) => status === id)
          if (next) setStatus(next)
        }}
      />
      <SuggestField
        label={NEW_TUNE_GENRE_LABEL}
        value={defaults.genre ?? ''}
        suggestions={GENRES}
        maxLength={TUNE_LIMITS.genre}
        onChange={setGenre}
      />
    </Group>
  )
}
