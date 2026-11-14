import { TunePickerSheet } from '../catalog/TunePickerSheet'
import { ADD_TUNES, addTuneName, PICKER_HINT, removeTuneName } from './listsCopy'
import { useTunePicker } from './useTunePicker'
import { useToast } from '../../ui/Toast'

/**
 * Adds tunes to one list, several in one visit. A press on a tune already in the list takes it
 * back out; a title nothing matches offers a new tune, which joins the list at once.
 */
export function AddTunesSheet({
  listId,
  taken,
  isOpen,
  onOpenChange,
}: {
  listId: string
  /** The user tune ids already in the list, from the screen's own read of it. */
  taken?: ReadonlySet<string>
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}) {
  const toast = useToast()
  const picker = useTunePicker(isOpen, listId, { toast: toast.show, taken })

  return (
    <TunePickerSheet
      title={ADD_TUNES}
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (open) return
        picker.dismissed()
        onOpenChange(false)
      }}
      selection={{ mode: 'multiple', taken: picker.taken }}
      search={picker}
      onPick={(entry) => picker.pick(entry.userTune.id)}
      onCreate={picker.create}
      rowName={(title, taken) => (taken ? removeTuneName(title) : addTuneName(title))}
      emptyHint={PICKER_HINT}
      error={picker.error}
    />
  )
}
