import { IonItem, IonLabel } from '@ionic/react'
import { Plus } from 'lucide-react'
import { MODES, TUNE_LIMITS, type Mode } from '../../api/vocabulary'
import { ADD_PART_MODE, PART_MODE_LABELS } from './detailFields'
import { asMode } from './tuneFormValues'
import { SuggestSelect } from './SuggestSelect'

/**
 * One mode row per part. Rows are only ever added while the form is open, so clearing a row
 * empties it rather than removing it; the save drops empty rows.
 */
export function ModeRows({
  modes,
  onChange,
}: {
  modes: (Mode | '')[]
  onChange: (modes: (Mode | '')[]) => void
}) {
  const rows: (Mode | '')[] = modes.length === 0 ? [''] : modes
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
          onChange={(value) => onChange(rows.map((m, i) => (i === index ? asMode(value) : m)))}
        />
      ))}
      {canAdd ? (
        <IonItem button detail={false} onClick={() => onChange([...rows, ''])}>
          <Plus aria-hidden="true" slot="start" className="size-6 text-(--ion-color-primary)" />
          <IonLabel color="primary">{ADD_PART_MODE}</IonLabel>
        </IonItem>
      ) : null}
    </>
  )
}
