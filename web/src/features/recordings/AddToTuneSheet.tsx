import { SEARCH_TUNES } from '../catalog/catalogCopy'
import { ADD_TO_TUNE_TITLE, addToTuneName } from './recordingsCopy'
import { useAddToTune } from './useAddToTune'
import type { RecordingView } from './useRecordings'
import { CANCEL } from '../../ui/confirmCopy'
import { useTuneFormLauncher } from '../tune/formLauncher'
import { Sheet } from '../../ui/Sheet'
import { useToast } from '../../ui/Toast'
import { useEndOnClose } from '../../ui/useEndOnClose'
import { TuneSearchList } from './TuneSearchList'

/**
 * Searches for the tune a recording belongs to and files it there, or carries the typed title
 * into a new tune, which takes the recording once saved.
 */
export function AddToTuneSheet({
  view,
  onClose,
}: {
  /** The recording to file, or null for a closed sheet; the parent nulls it from onClose. */
  view: RecordingView | null
  onClose: () => void
}) {
  const toast = useToast()
  const form = useTuneFormLauncher()
  const add = useAddToTune(view, { toast: toast.show, onClose })

  const finish = () => {
    const recordingId = view?.recording.id
    const title = add.dismissed()
    if (title === null || recordingId === undefined) return
    // The tune form files the recording itself once the tune is saved.
    add.abandon()
    form.open({ initialTitle: title, recordingId })
  }

  useEndOnClose(add.closing, finish)

  return (
    <Sheet
      isOpen={add.open}
      onOpenChange={(open) => {
        if (!open) add.cancel()
      }}
      title={ADD_TO_TUNE_TITLE}
      height="full"
      locked={add.pending}
      leading={{ label: CANCEL, onPress: add.cancel, isDisabled: add.pending }}
    >
      <TuneSearchList
        label={SEARCH_TUNES}
        query={add.query}
        onQuery={add.setQuery}
        matches={add.matches}
        onPick={(entry) => add.pick(entry.tune.id)}
        onCreate={add.create}
        rowName={addToTuneName}
        error={add.error}
      />
    </Sheet>
  )
}
