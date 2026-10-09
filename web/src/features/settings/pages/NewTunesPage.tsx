import { TUNE_LIMITS } from '../../../api/vocabulary'
import { GENRES } from '../../../constants'
import { Group } from '../../../ui/form/Group'
import { StatusRail } from '../../../ui/form/StatusRail'
import { SuggestField } from '../../../ui/form/SuggestField'
import { NEW_TUNE_GENRE_LABEL, NEW_TUNE_STATUS_LABEL, NEW_TUNES_FOOTER } from '../newTunes'
import { useNewTuneSettings } from '../useNewTuneSettings'

/** The status and genre every new tune starts with. */
export function NewTunesPage() {
  const { defaults, setGenre, setStatus, genreError, statusError } = useNewTuneSettings()
  if (!defaults) return null
  return (
    <>
      <Group header={NEW_TUNE_STATUS_LABEL} plain error={statusError ?? undefined}>
        <StatusRail label={NEW_TUNE_STATUS_LABEL} value={defaults.status} onChange={setStatus} />
      </Group>
      <Group footer={NEW_TUNES_FOOTER} error={genreError ?? undefined}>
        <SuggestField
          label={NEW_TUNE_GENRE_LABEL}
          value={defaults.genre ?? ''}
          suggestions={GENRES}
          maxLength={TUNE_LIMITS.genre}
          onChange={setGenre}
        />
      </Group>
    </>
  )
}
