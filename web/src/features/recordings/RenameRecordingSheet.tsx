import { IonButton, IonInput, IonItem } from '@ionic/react'
import { useRef, useState } from 'react'
import { updateRecording } from '../../commands/recordings'
import { useAction } from '../../ui/useAction'
import { useDb } from '../../db/DbProvider'
import { Group } from '../../ui/Group'
import { Sheet } from '../../ui/Sheet'
import { SONG_LIMITS } from '../song/limits'
import type { RecordingView } from './useRecordings'

/** One box for a recording's name. Saving a blank name clears it. */
export function RenameRecordingSheet({
  view,
  onClose,
}: {
  /** The recording to rename, or null for a closed sheet; the parent nulls it from onClose. */
  view: RecordingView | null
  onClose: () => void
}) {
  const db = useDb()
  const { error, pending, runThen, clear } = useAction()
  const [name, setName] = useState('')
  const [closing, setClosing] = useState(false)
  const [openedFor, setOpenedFor] = useState<RecordingView | null>(null)
  // The recording a save is running for. A ref, because two submits in one tick both read the
  // same `pending` state.
  const saving = useRef<RecordingView | null>(null)

  // Reset during render so the sheet's first frame already shows the recording's stored name,
  // whatever a cancelled edit left in the box.
  if (view !== openedFor) {
    setOpenedFor(view)
    if (view) {
      setName(view.recording.label ?? '')
      setClosing(false)
      clear()
    }
  }

  // A dismissal that ends after a new recording opened belongs to the old one, so it closes nothing.
  const dismissed = () => {
    saving.current = null
    if (view === null || closing) onClose()
  }

  const save = () => {
    // Enter reaches this through the hidden submit button, which the toolbar's disabled state
    // does not cover.
    if (!view || closing || saving.current === view) return
    saving.current = view
    const label = name.trim() || null
    runThen(
      async () => {
        await updateRecording(db, view.recording.id, { label }).catch((caught: unknown) => {
          saving.current = null
          throw caught
        })
      },
      () => setClosing(true),
    )
  }

  return (
    <Sheet
      open={view !== null && !closing}
      title="Rename recording"
      dismissible={false}
      onClose={dismissed}
      start={
        <IonButton disabled={pending} onClick={() => setClosing(true)}>
          Cancel
        </IonButton>
      }
      end={
        <IonButton strong disabled={pending || closing} onClick={save}>
          Save
        </IonButton>
      }
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        <button type="submit" tabIndex={-1} aria-hidden="true" className="sr-only" />
        <Group header="Recording name" error={error}>
          <IonItem>
            <IonInput
              aria-label="Recording name"
              maxlength={SONG_LIMITS.title}
              value={name}
              enterkeyhint="done"
              onIonInput={(event) => {
                setName(String(event.detail.value ?? ''))
                clear()
              }}
            />
          </IonItem>
        </Group>
      </form>
    </Sheet>
  )
}
