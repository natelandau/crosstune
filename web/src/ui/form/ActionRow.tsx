import { Button as AriaButton } from 'react-aria-components'
import { FIELD_ROW } from './FieldRow'

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
      className={`${FIELD_ROW} ${destructive ? 'text-danger' : 'text-slate'} data-[disabled]:opacity-40 data-[pressed]:opacity-60`}
    >
      {label}
    </AriaButton>
  )
}
