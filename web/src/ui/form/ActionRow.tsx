import { Button as AriaButton } from 'react-aria-components'
import { FIELD_ROW_PRESSABLE } from './FieldRow'

/** A row that runs an action when pressed, such as Sync now or Sign out. */
export function ActionRow({
  label,
  destructive = false,
  isDisabled = false,
  onPress,
}: {
  label: string
  destructive?: boolean
  isDisabled?: boolean
  onPress: () => void
}) {
  return (
    <AriaButton
      isDisabled={isDisabled}
      onPress={onPress}
      className={`${FIELD_ROW_PRESSABLE} ${destructive ? 'text-danger' : 'text-action'} font-medium data-[disabled]:opacity-40`}
    >
      {label}
    </AriaButton>
  )
}
