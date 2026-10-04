import { IonItem, IonLabel } from '@ionic/react'
import { Group } from '../../../ui/Group'
import { RECORDED_HEADER, recordedLine } from '../copy'
import { equivalenceText } from '../equivalences'
import type { Equivalence, Recorded } from '../types'

/** Always shown. The comparison under the total appears only when the total earns one. */
export function RecordedBlock({
  recorded,
  equivalence,
  tuneTitles,
}: {
  recorded: Recorded
  equivalence: Equivalence | null
  tuneTitles: ReadonlyMap<string, string>
}) {
  const comparison = equivalence
    ? equivalenceText(
        equivalence,
        equivalence.tune_id ? tuneTitles.get(equivalence.tune_id) : undefined,
      )
    : undefined
  return (
    <Group header={RECORDED_HEADER} footer={comparison}>
      <IonItem lines="none">
        <IonLabel className="tabular-nums">
          {recordedLine(recorded.count, recorded.total_ms)}
        </IonLabel>
      </IonItem>
    </Group>
  )
}
