import { Plus } from 'lucide-react'
import { Button as AriaButton } from 'react-aria-components'
import { LIST_LIMITS } from '../../api/vocabulary'
import { addTunesToListTitle } from '../lists/listPickerCopy'
import {
  CREATE_LIST,
  LIST_NAME_PLACEHOLDER,
  NEW_LIST_ITEM,
  NEW_LIST_NAME_LABEL,
} from '../lists/listsCopy'
import { useListPicker, type ListAddition } from '../lists/useListPicker'
import { Button } from '../../ui/Button'
import { FIELD_ROW_PRESSABLE } from '../../ui/form/FieldRow'
import { Group } from '../../ui/form/Group'
import { TextField } from '../../ui/form/TextField'
import { Sheet } from '../../ui/Sheet'
import { useEndOnClose } from '../../ui/useEndOnClose'

/**
 * Adds one or more tunes to a list, or to a new one named inline, without leaving the page
 * behind it. Each list's row says how much of the tunes it already holds; a list that holds
 * them all cannot be picked.
 */
export function ListPickerSheet({
  userTuneIds,
  excludeListId,
  isOpen,
  onOpenChange,
  title,
  onAdded,
}: {
  userTuneIds: readonly string[]
  /** Left off the offered lists, such as the list the tunes were selected on. */
  excludeListId?: string
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  /** Defaults to naming how many tunes are added. */
  title?: string
  /** What the add did, for a caller that toasts it and offers the undo. */
  onAdded?: (addition: ListAddition) => void
}) {
  const picker = useListPicker(isOpen, userTuneIds, {
    excludeListId,
    onAdded,
    onClose: () => onOpenChange(false),
  })
  const { pending } = picker

  useEndOnClose(isOpen && picker.closing, picker.dismissed)

  return (
    <Sheet
      isOpen={isOpen && !picker.closing}
      onOpenChange={(open) => {
        if (!open) picker.dismissed()
      }}
      title={title ?? addTunesToListTitle(userTuneIds.length)}
      height="part"
      locked={pending || picker.name.trim() !== ''}
    >
      <div className="pb-4">
        <Group error={picker.error ?? undefined}>
          {picker.rows.map((row) => (
            <AriaButton
              key={row.id}
              isDisabled={row.disabled}
              onPress={() => picker.add(row.id)}
              className={`${FIELD_ROW_PRESSABLE} disabled:opacity-40`}
            >
              <span className="min-w-0 flex-1 truncate text-start">{row.name}</span>
              {row.note && <span className="t-secondary t-num text-ink-2">{row.note}</span>}
            </AriaButton>
          ))}
          {picker.creating ? (
            <form
              noValidate
              className="flex items-center"
              onSubmit={(event) => {
                event.preventDefault()
                picker.create()
              }}
            >
              <div className="min-w-0 flex-1">
                <TextField
                  standalone
                  label={NEW_LIST_NAME_LABEL}
                  placeholder={LIST_NAME_PLACEHOLDER}
                  value={picker.name}
                  maxLength={LIST_LIMITS.name}
                  enterKeyHint="done"
                  autoFocus
                  onChange={picker.setName}
                />
              </div>
              <Button
                type="submit"
                label={CREATE_LIST}
                isDisabled={!picker.name.trim() || pending}
              />
            </form>
          ) : (
            <AriaButton
              isDisabled={pending}
              onPress={() => picker.setCreating(true)}
              className={`${FIELD_ROW_PRESSABLE} text-action font-medium disabled:opacity-40`}
            >
              <Plus className="size-5 shrink-0" aria-hidden />
              {NEW_LIST_ITEM}
            </AriaButton>
          )}
        </Group>
      </div>
    </Sheet>
  )
}
