import { TunePickerSheet } from '../catalog/TunePickerSheet'
import { ADD_TUNES, addTuneName, IN_THIS_LIST, PICKER_HINT } from './listsCopy'
import { useTunePicker } from './useTunePicker'
import { useToast } from '../../ui/Toast'

/**
 * Adds tunes to one list, several in one visit. A tune already in the list says so and cannot
 * be picked; a title nothing matches offers a new tune, which joins the list at once and shows
 * there as taken.
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
      selection={{ mode: 'multiple', taken: picker.taken, takenNote: IN_THIS_LIST }}
      search={picker}
      onPick={(entry) => picker.pick(entry.userTune.id)}
      onCreate={picker.create}
      rowName={addTuneName}
      emptyHint={PICKER_HINT}
      error={picker.error}
    />
  )
}
