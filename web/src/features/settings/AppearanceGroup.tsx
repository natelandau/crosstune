import { IonItem, IonLabel, IonSegment, IonSegmentButton } from '@ionic/react'
import { Group } from '../../ui/Group'
import {
  APPEARANCE_LABELS,
  APPEARANCES,
  setAppearance,
  setTextSize,
  TEXT_SIZE_LABELS,
  TEXT_SIZES,
  useAppearance,
  useTextSize,
  type Appearance,
  type TextSize,
} from './appearance'

/** Theme and text size, one control per group so each keeps its own help text. */
export function AppearanceGroup() {
  const appearance = useAppearance()
  const textSize = useTextSize()
  return (
    <>
      <Group header="Appearance" footer="System follows the phone when it switches.">
        <IonItem lines="none">
          <IonSegment
            aria-label="Theme"
            value={appearance}
            onIonChange={(event) => setAppearance(event.detail.value as Appearance)}
          >
            {APPEARANCES.map((option) => (
              <IonSegmentButton key={option} value={option}>
                <IonLabel>{APPEARANCE_LABELS[option]}</IonLabel>
              </IonSegmentButton>
            ))}
          </IonSegment>
        </IonItem>
      </Group>
      <Group>
        <IonItem lines="none">
          <IonSegment
            aria-label="Text size"
            value={textSize}
            onIonChange={(event) => setTextSize(event.detail.value as TextSize)}
          >
            {TEXT_SIZES.map((option) => (
              <IonSegmentButton key={option} value={option}>
                <IonLabel>{TEXT_SIZE_LABELS[option]}</IonLabel>
              </IonSegmentButton>
            ))}
          </IonSegment>
        </IonItem>
      </Group>
    </>
  )
}
