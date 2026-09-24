import { IonCheckbox, IonItem } from '@ionic/react'
import { INSTRUMENTS, type Instrument } from '../../api/vocabulary'
import { INSTRUMENT_LABELS } from '../../constants'
import { TUNING_FIELDS } from './instruments'

// Only instruments a song can show a tuning for, until the tunings map reaches the form.
const LISTED = INSTRUMENTS.filter((instrument) =>
  Object.values(TUNING_FIELDS).some((field) => field.instrument === instrument),
)

/** One checkbox row per instrument. */
export function InstrumentRows({
  value,
  onToggle,
}: {
  value: ReadonlySet<Instrument>
  onToggle: (instrument: Instrument, on: boolean) => void
}) {
  return (
    <>
      {LISTED.map((instrument) => (
        <IonItem key={instrument}>
          <IonCheckbox
            checked={value.has(instrument)}
            onIonChange={(event) => onToggle(instrument, event.detail.checked)}
          >
            {INSTRUMENT_LABELS[instrument]}
          </IonCheckbox>
        </IonItem>
      ))}
    </>
  )
}
