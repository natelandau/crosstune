import { IonButton, IonInput, IonItem } from '@ionic/react'
import { useState } from 'react'
import { RECORDING_LIMITS } from '../../api/vocabulary'
import { updateRecording } from '../../commands/recordings'
import { useDb } from '../../db/DbProvider'
import { Group } from '../../ui/Group'
import { Sheet } from '../../ui/Sheet'
import { useAction } from '../../ui/useAction'
import { RECORDING_NAME_LABEL } from './recordingCopy'
import type { RecordingView } from './useRecordings'
import { CANCEL } from '../../ui/Confirm'
import { useSheetSession } from '../../ui/useSheetSession'

export const RECORDING_NAME_PLACEHOLDER = 'Jam at Tom’s, take 2, …'
export const RENAME_RECORDING_TITLE = 'Rename recording'

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
  // The stored name on open, whatever a cancelled edit left in the box.
  const sheet = useSheetSession(view, {
    onOpen: (opened) => {
      setName(opened.recording.label ?? '')
      clear()
    },
    onClose,
  })

  const save = () => {
    // Enter reaches this through the hidden submit button, which the toolbar's disabled state
    // does not cover.
    if (!view || !sheet.canSave()) return
    sheet.beginSave()
    const label = name.trim() || null
    runThen(async () => {
      await updateRecording(db, view.recording.id, { label }).catch(sheet.saveFailed)
    }, sheet.close)
  }

  return (
    <Sheet
      open={sheet.open}
      title={RENAME_RECORDING_TITLE}
      dismissible={false}
      onClose={sheet.dismissed}
      start={
        <IonButton disabled={pending} onClick={sheet.close}>
          {CANCEL}
        </IonButton>
      }
      end={
        <IonButton strong disabled={pending || sheet.closing} onClick={save}>
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
        {/* The sheet's title already names the one field, so a header would repeat it. */}
        <Group error={error}>
          <IonItem>
            <IonInput
              aria-label={RECORDING_NAME_LABEL}
              placeholder={RECORDING_NAME_PLACEHOLDER}
              maxlength={RECORDING_LIMITS.label}
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
