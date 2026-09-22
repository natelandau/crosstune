import { IonCheckbox, IonItem } from '@ionic/react'
import { INSTRUMENT_LABELS, INSTRUMENTS, type Instrument } from '../../constants'

/** One checkbox row per instrument, the same rows on the settings screen and at first run. */
export function InstrumentRows({
  value,
  onToggle,
}: {
  value: ReadonlySet<Instrument>
  onToggle: (instrument: Instrument, on: boolean) => void
}) {
  return (
    <>
      {INSTRUMENTS.map((instrument) => (
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
