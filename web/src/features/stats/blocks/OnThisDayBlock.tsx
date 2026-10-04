import { IonItem, IonLabel } from '@ionic/react'
import { Group } from '../../../ui/Group'
import { ON_THIS_DAY_HEADER, onThisDayLine } from '../copy'
import type { OnThisDay } from '../types'

const RECORDING_KINDS: readonly OnThisDay['kind'][] = ['first_recording', 'recording']

export function OnThisDayBlock({
  lines,
  tuneTitles,
  recordingTitles,
}: {
  lines: readonly OnThisDay[]
  tuneTitles: ReadonlyMap<string, string>
  recordingTitles: ReadonlyMap<string, string | null>
}) {
  return (
    <Group header={ON_THIS_DAY_HEADER}>
      {lines.map((line) => {
        const title = RECORDING_KINDS.includes(line.kind)
          ? (recordingTitles.get(line.id) ?? null)
          : (tuneTitles.get(line.id) ?? null)
        return (
          <IonItem key={`${line.kind}:${line.id}`} lines="full">
            <IonLabel className="whitespace-normal">{onThisDayLine(line, title)}</IonLabel>
          </IonItem>
        )
      })}
    </Group>
  )
}
