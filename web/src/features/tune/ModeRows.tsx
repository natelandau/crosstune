import { IonItem, IonLabel } from '@ionic/react'
import { Plus } from 'lucide-react'
import { MODES, TUNE_LIMITS, type Mode } from '../../api/vocabulary'
import { ADD_PART_MODE, PART_MODE_LABELS } from './detailFields'
import { modeRows } from './tuneFormValues'
import { SuggestSelect } from './SuggestSelect'

/**
 * One mode row per part. Rows are only ever added while the form is open, so clearing a row
 * empties it rather than removing it; the save drops empty rows.
 */
export function ModeRows({
  modes,
  onChange,
  onAdd,
}: {
  modes: readonly (Mode | '')[]
  /** Takes the part rather than a whole list, so the form applies each pick to its latest
   * modes and two picks in one tick both land. */
  onChange: (index: number, value: string) => void
  onAdd: () => void
}) {
  const rows = modeRows(modes)
  const canAdd = rows.length < TUNE_LIMITS.modes && rows.at(-1) !== ''
  return (
    <>
      {PART_MODE_LABELS.slice(0, rows.length).map((label, index) => (
        <SuggestSelect
          key={label}
          detail={label}
          label={label}
          value={rows[index] ?? ''}
          options={MODES}
          other={false}
          onChange={(value) => onChange(index, value)}
        />
      ))}
      {canAdd ? (
        <IonItem button detail={false} onClick={onAdd}>
          <Plus aria-hidden="true" slot="start" className="size-6 text-(--ion-color-primary)" />
          <IonLabel color="primary">{ADD_PART_MODE}</IonLabel>
        </IonItem>
      ) : null}
    </>
  )
}
