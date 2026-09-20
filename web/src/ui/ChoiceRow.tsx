import { IonSelect, IonSelectOption } from '@ionic/react'
import { usePointer } from '../platform/pointer'
import { FieldRow } from './FieldRow'

/**
 * A closed choice as a field row: the label leads, the chosen option trails, and the picker is
 * the client's own, an action sheet on touch and a popover on a mouse. The value is never empty,
 * which is what separates this from `SuggestSelect`: a setting is always set, and its vocabulary
 * is the client's rather than the musician's, so there is no empty choice and no `Other…`.
 */
export function ChoiceRow<T extends string>({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string
  value: T
  options: readonly T[]
  labels: Record<T, string>
  onChange: (value: T) => void
}) {
  const mouse = usePointer() === 'mouse'
  return (
    <FieldRow label={label}>
      <IonSelect
        aria-label={label}
        interface={mouse ? 'popover' : 'action-sheet'}
        // The sheet names the field it sets; its options alone do not say what they belong to.
        interfaceOptions={{ header: label }}
        value={value}
        onIonChange={(event) => onChange(event.detail.value as T)}
      >
        {options.map((option) => (
          <IonSelectOption key={option} value={option}>
            {labels[option]}
          </IonSelectOption>
        ))}
      </IonSelect>
    </FieldRow>
  )
}
