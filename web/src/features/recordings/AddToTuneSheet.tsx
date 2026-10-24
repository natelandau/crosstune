import type { Source } from '../../usage/events'
import { SEARCH_TUNES } from '../catalog/catalogCopy'
import { ADD_TO_TUNE_TITLE, addToTuneName } from './recordingsCopy'
import { useAddToTune } from './useAddToTune'
import type { RecordingView } from './useRecordings'
import { useCreateTune } from '../tune/useCreateTune'
import { Sheet } from '../../ui/Sheet'
import { messageFor } from '../../ui/useAction'
import { useToast } from '../../ui/Toast'
import { useEndOnClose } from '../../ui/useEndOnClose'
import { TuneSearchList } from './TuneSearchList'

/**
 * Searches for the tune a recording belongs to and files it there, or creates a tune by the
 * typed title, files the recording under it, and opens it.
 */
export function AddToTuneSheet({
  view,
  source,
  onClose,
  onOpenTune,
}: {
  /** The screen the sheet is on, reported when it adds a tune. */
  source: Source
  /** The recording to file, or null for a closed sheet; the parent nulls it from onClose. */
  view: RecordingView | null
  onClose: () => void
  /** Opens a tune created here, once the recording is filed under it. */
  onOpenTune: (tuneId: string) => void
}) {
  const toast = useToast()
  const createTune = useCreateTune()
  const add = useAddToTune(view, { toast: toast.show, onClose })

  const finish = () => {
    const recordingId = view?.recording.id
    const title = add.dismissed()
    if (title === null || recordingId === undefined) return
    // Created once the sheet has gone, so the page opens over a screen with no sheet left.
    createTune({ title, source, recordingId })
      .then(({ tuneId, filingError }) => {
        if (filingError) toast.show(filingError)
        onOpenTune(tuneId)
      })
      .catch((caught: unknown) => toast.show(messageFor(caught)))
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
      cancel={{ onPress: add.cancel, isDisabled: add.pending }}
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
