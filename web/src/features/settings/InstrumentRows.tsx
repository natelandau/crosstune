import { IonCheckbox, IonItem } from '@ionic/react'
import type { Instrument } from '../../api/vocabulary'
import { INSTRUMENT_LABELS } from '../../constants'
import { LISTED_INSTRUMENTS } from './instruments'

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
      {LISTED_INSTRUMENTS.map((instrument) => (
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
