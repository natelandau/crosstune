import { Capsule } from '../../ui/Capsule'
import { Rail } from '../../ui/Rail'
import { originLabel } from './recordingRow'
import type { OriginChoice } from './useRecordingsOrigin'

export const ALL_RECORDINGS = 'All'
export const MY_RECORDINGS = 'Mine'
export const RECORDINGS_FILTER_LABEL = 'Recordings by source'

/** `origins` are the import sources to offer, in the order to show them. */
export function RecordingsOriginFilter({
  choice,
  origins,
  onChange,
}: {
  choice: OriginChoice
  origins: readonly string[]
  onChange: (next: OriginChoice) => void
}) {
  return (
    <div className="pt-1 pb-2">
      <Rail label={RECORDINGS_FILTER_LABEL}>
        <Capsule pressed={choice === 'all'} onPress={() => onChange('all')}>
          {ALL_RECORDINGS}
        </Capsule>
        <Capsule pressed={choice === 'own'} onPress={() => onChange('own')}>
          {MY_RECORDINGS}
        </Capsule>
        {origins.map((origin) => (
          <Capsule key={origin} pressed={choice === origin} onPress={() => onChange(origin)}>
            {originLabel(origin)}
          </Capsule>
        ))}
      </Rail>
    </div>
  )
}
