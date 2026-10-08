import { useId, useRef } from 'react'
import { RECORDING_LIMITS } from '../../api/vocabulary'
import { RECORDING_NAME_LABEL } from './recordingCopy'
import {
  DATE_RECORDED_LABEL,
  EDIT_RECORDING_TITLE,
  NAME_LABEL,
  RECORDING_NAME_PLACEHOLDER,
  SAVE_RECORDING,
} from './recordingsCopy'
import { useEditRecording } from './useEditRecording'
import type { RecordingView } from './useRecordings'
import { CANCEL } from '../../ui/confirmCopy'
import { Group } from '../../ui/form/Group'
import { PartialDateField } from '../../ui/form/PartialDateField'
import { TextField } from '../../ui/form/TextField'
import { Sheet } from '../../ui/Sheet'
import { useEndOnClose } from '../../ui/useEndOnClose'

/**
 * A recording's name and the date it was recorded, as a part-height form. The date is a year,
 * optionally narrowed to a month and a day; a take's exact time survives only while its date
 * parts are left alone.
 */
export function EditRecordingSheet({
  view,
  onClose,
}: {
  /** The recording to edit, or null for a closed sheet; the parent nulls it from onClose. */
  view: RecordingView | null
  onClose: () => void
}) {
  const dateRef = useRef<HTMLDivElement>(null)
  const dateErrorId = useId()
  const edit = useEditRecording(view, {
    onClose,
    onDateError: () => dateRef.current?.querySelector('input')?.focus(),
  })

  useEndOnClose(edit.closing, edit.dismissed)

  return (
    <Sheet
      isOpen={edit.open}
      onOpenChange={(open) => {
        if (!open) edit.close()
      }}
      title={EDIT_RECORDING_TITLE}
      height="part"
      locked={edit.dirty || edit.pending}
      leading={{ label: CANCEL, onPress: edit.close, isDisabled: edit.pending }}
      primary={{
        label: SAVE_RECORDING,
        onPress: edit.save,
        isDisabled: edit.pending || edit.closing,
      }}
    >
      <form
        noValidate
        className="pb-4"
        onSubmit={(event) => {
          event.preventDefault()
          edit.save()
        }}
      >
        {/* A form with several fields submits on Enter only when it has a submit button. */}
        <button type="submit" tabIndex={-1} aria-hidden="true" className="sr-only" />
        <Group header={NAME_LABEL} error={edit.error ?? undefined}>
          <TextField
            standalone
            label={RECORDING_NAME_LABEL}
            placeholder={RECORDING_NAME_PLACEHOLDER}
            value={edit.name}
            maxLength={RECORDING_LIMITS.label}
            enterKeyHint="done"
            onChange={edit.setName}
          />
        </Group>
        <Group
          header={DATE_RECORDED_LABEL}
          error={edit.dateError ?? undefined}
          errorId={dateErrorId}
          footer={edit.timeNote ?? undefined}
        >
          <PartialDateField
            ref={dateRef}
            value={edit.parts}
            refusedPart={edit.dateError ? 'year' : null}
            describedBy={dateErrorId}
            onChange={edit.editParts}
          />
        </Group>
      </form>
    </Sheet>
  )
}
