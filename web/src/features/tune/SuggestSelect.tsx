import { IonInput, IonItem, IonSelect, IonSelectOption } from '@ionic/react'
import { useState } from 'react'
import { usePointer } from '../../platform/pointer'
import { FieldRow, NOT_SET } from '../../ui/FieldRow'

export const OTHER_OPTION = 'Other…'

// A sentinel no suggestion list can contain, so choosing Other never collides with a real value.
const OTHER = '\u0000other'
// The empty choice carries its own sentinel too, so an empty value matches no option and the
// row falls back to its placeholder instead of showing the choice's label.
const NONE = '\u0000none'

/**
 * A closed list of suggestions that never limits the musician: Other… reveals a text field,
 * and a value typed there shows as its own option afterwards.
 */
export function SuggestSelect({
  label,
  rowLabel,
  value,
  options,
  other,
  maxLength,
  placeholder = NOT_SET,
  emptyLabel = placeholder,
  clearOnOther = true,
  detail,
  showLabel = true,
  onChange,
  onPickerClose,
}: {
  label: string
  /** The row's visible label when a header already carries the field's full name. Defaults to
   * `label`, which stays the accessible name either way. */
  rowLabel?: string
  value: string
  options: readonly string[]
  /** Offer an Other… choice that reveals a text field. */
  other: boolean
  maxLength?: number
  /** Shown for an empty value. Defaults to "Not set". */
  placeholder?: string
  /** The empty choice's own label, for a row whose placeholder does not name what picking it
   * does. Defaults to the placeholder. */
  emptyLabel?: string
  /** False keeps the current value when Other… opens, for a row that clears through its own
   * option and where nothing on screen would show the loss. */
  clearOnOther?: boolean
  /** Rendered as `data-detail` on the select row, naming the detail field it edits. */
  detail?: string
  /** False when a group header above already names the field: the row then shows only the
   * value, and `label` stays its accessible name. */
  showLabel?: boolean
  onChange: (value: string) => void
  /** Called whenever the picker closes, by a pick or not. Ionic sends no change for a pick of
   * the value already shown, so this is the one sign that the musician chose it. */
  onPickerClose?: () => void
}) {
  const mouse = usePointer() === 'mouse'
  const custom = value !== '' && !options.includes(value)
  const [typing, setTyping] = useState(false)
  // The typed text lives apart from `value`, which would blank the field whenever the text
  // on its way to a custom value happens to equal a suggestion.
  const [draft, setDraft] = useState('')
  const choices = custom ? [...options, value] : options
  const select = (
    <IonSelect
      aria-label={label}
      placeholder={placeholder}
      interface={mouse ? 'popover' : 'action-sheet'}
      // The sheet names the field it sets; its options alone do not say what they belong to.
      interfaceOptions={{ header: label }}
      onIonDismiss={onPickerClose}
      value={typing ? OTHER : value}
      onIonChange={(event) => {
        const next = String(event.detail.value ?? '')
        if (next === OTHER) {
          if (clearOnOther) {
            // Saves what the Other field shows, never a pick the select no longer displays.
            const kept = custom ? value : ''
            setDraft(kept)
            onChange(kept)
          } else {
            setDraft(value)
          }
          setTyping(true)
          return
        }
        setTyping(false)
        onChange(next === NONE ? '' : next)
      }}
    >
      <IonSelectOption value={NONE}>{emptyLabel}</IonSelectOption>
      {choices.map((choice) => (
        <IonSelectOption key={choice} value={choice}>
          {choice}
        </IonSelectOption>
      ))}
      {other ? <IonSelectOption value={OTHER}>{OTHER_OPTION}</IonSelectOption> : null}
    </IonSelect>
  )
  return (
    <>
      {showLabel ? (
        <FieldRow label={rowLabel ?? label} detail={detail}>
          {select}
        </FieldRow>
      ) : (
        <IonItem data-detail={detail}>{select}</IonItem>
      )}
      {typing ? (
        <IonItem>
          <IonInput
            aria-label={`Other ${label.toLowerCase()}`}
            label={`Other ${label.toLowerCase()}`}
            labelPlacement="stacked"
            autofocus
            maxlength={maxLength}
            value={draft}
            onIonInput={(event) => {
              const text = String(event.detail.value ?? '')
              setDraft(text)
              onChange(text)
            }}
          />
        </IonItem>
      ) : null}
    </>
  )
}
