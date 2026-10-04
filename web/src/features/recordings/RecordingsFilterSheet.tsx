import { IonButton } from '@ionic/react'
import { ChoiceRow } from '../../ui/ChoiceRow'
import { FILTERS } from '../../ui/filterCopy'
import { Group } from '../../ui/Group'
import { Sheet } from '../../ui/Sheet'
import { originLabel, sortOrigins } from './recordingRow'
import type { OriginChoice } from './useRecordingsOrigin'

export const ALL_RECORDINGS = 'All'
export const MY_RECORDINGS = 'Mine'
export const SOURCE_SECTION = 'Source'

/** `origins` are the import sites the user holds. */
export function RecordingsFilterSheet({
  open,
  choice,
  origins,
  onChange,
  onClose,
}: {
  open: boolean
  choice: OriginChoice
  origins: readonly string[]
  onChange: (next: OriginChoice) => void
  onClose: () => void
}) {
  // A chosen site the user no longer holds keeps its option, or the select would read as All
  // while the list stays narrowed.
  const stale = choice !== 'all' && choice !== 'own' && !origins.includes(choice)
  const sites = sortOrigins(stale ? [...origins, choice] : origins)
  const options = ['all', 'own', ...sites]
  const labels = Object.fromEntries(
    options.map((option) => [
      option,
      option === 'all' ? ALL_RECORDINGS : (originLabel(option) ?? MY_RECORDINGS),
    ]),
  )
  return (
    <Sheet
      open={open}
      title={FILTERS}
      onClose={onClose}
      start={
        <IonButton disabled={choice === 'all'} onClick={() => onChange('all')}>
          Reset
        </IonButton>
      }
      end={
        <IonButton strong onClick={onClose}>
          Done
        </IonButton>
      }
    >
      <Group>
        <ChoiceRow
          label={SOURCE_SECTION}
          value={choice}
          options={options}
          labels={labels}
          onChange={onChange}
        />
      </Group>
    </Sheet>
  )
}
