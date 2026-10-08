import { SEARCH_TUNES } from '../catalog/catalogCopy'
import { ADD_TUNES, addTuneName, IN_THIS_LIST, PICKER_HINT } from './listsCopy'
import { useTunePicker } from './useTunePicker'
import { DONE } from '../../ui/confirmCopy'
import { TuneSearchList } from '../recordings/TuneSearchList'
import { useTuneFormLauncher } from '../tune/formLauncher'
import { Sheet } from '../../ui/Sheet'
import { useToast } from '../../ui/Toast'
import { useEndOnClose } from '../../ui/useEndOnClose'

/**
 * Searches the catalog and adds tunes to one list, several in one visit. A tune already in
 * the list says so and cannot be picked; a title nothing matches offers a new tune, which
 * joins the list once saved.
 */
export function TunePickerSheet({
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
  const form = useTuneFormLauncher()
  const picker = useTunePicker(isOpen, listId, { toast: toast.show, taken })

  const finish = () => {
    const title = picker.dismissed()
    onOpenChange(false)
    if (title !== null) form.open({ initialTitle: title, listId })
  }

  useEndOnClose(picker.closing, finish)

  return (
    <Sheet
      isOpen={isOpen && !picker.closing}
      onOpenChange={(open) => {
        if (!open) finish()
      }}
      title={ADD_TUNES}
      height="full"
      // Picks apply at once, so Cancel would claim an undo it cannot give; Done alone closes.
      leading={null}
      primary={{ label: DONE, onPress: picker.done }}
    >
      <TuneSearchList
        label={SEARCH_TUNES}
        query={picker.query}
        onQuery={picker.setQuery}
        matches={picker.matches}
        onPick={(entry) => picker.pick(entry.userTune.id)}
        onCreate={picker.create}
        rowName={addTuneName}
        taken={{ ids: picker.taken, note: IN_THIS_LIST }}
        hint={PICKER_HINT}
        error={picker.error}
        keepFocus
      />
    </Sheet>
  )
}
