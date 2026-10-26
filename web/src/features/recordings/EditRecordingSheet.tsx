import { ChevronRight } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import { RECORDING_LIMITS } from '../../api/vocabulary'
import { RECORDING_NAME_LABEL } from './recordingCopy'
import {
  CLEAR_LOCATION,
  DATE_RECORDED_LABEL,
  EDIT_RECORDING_TITLE,
  LOCATION_LABEL,
  locationRowName,
  NAME_LABEL,
  NAME_LOCATION_TITLE,
  NOTES_LABEL,
  PLAYERS_LABEL,
  RECORDING_NAME_PLACEHOLDER,
  RECORDING_NOTES_PLACEHOLDER,
  SAVE_LOCATION_NAME,
  SAVE_RECORDING,
} from './recordingsCopy'
import { LocationPage } from './LocationPage'
import { NameLocationForm } from './NameLocationForm'
import { namingCandidates } from './stagedPlace'
import { useEditRecording, type EditRecordingPage } from './useEditRecording'
import type { RecordingView } from './useRecordings'
import { NOT_SET } from '../../ui/fieldCopy'
import { ActionRow } from '../../ui/form/ActionRow'
import { FIELD_LABEL, FIELD_ROW_PRESSABLE, FIELD_VALUE_SHAPE } from '../../ui/form/FieldRow'
import { useOverlayClaim } from '../../ui/overlayClaim'
import { useEscapeCapture } from '../../ui/useEscapeCapture'
import { Group } from '../../ui/form/Group'
import { PartialDateField } from '../../ui/form/PartialDateField'
import { SuggestField } from '../../ui/form/SuggestField'
import { TextField } from '../../ui/form/TextField'
import { Sheet } from '../../ui/Sheet'
import { useEndOnClose } from '../../ui/useEndOnClose'

/**
 * A recording's name, the date it was recorded, its players, place, and notes, as a
 * part-height form. The date is a year, optionally narrowed to a month and a day; a recording's
 * exact time survives only while its date parts are left alone. The Location row swaps the sheet's
 * body for the location page, with Back in its header; Escape and a device back press go back
 * a page before they reach the sheet.
 */
export function EditRecordingSheet({
  view,
  onClose,
  initialPage,
  settleMs,
}: {
  /** The recording to edit, or null for a closed sheet; the parent nulls it from onClose. */
  view: RecordingView | null
  onClose: () => void
  /** Opens on the location page rather than the form. */
  initialPage?: 'location'
  /** How long the location search waits for typing to settle. */
  settleMs?: number
}) {
  const dateRef = useRef<HTMLDivElement>(null)
  const locationRowRef = useRef<HTMLButtonElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const dateErrorId = useId()
  const edit = useEditRecording(view, {
    onClose,
    onDateError: () => dateRef.current?.querySelector('input')?.focus(),
    initialPage: initialPage ?? 'form',
  })
  const [locationName, setLocationName] = useState('')

  useEndOnClose(edit.closing, edit.dismissed)
  const { page, showPage } = edit
  const onPage = edit.open && page !== 'form'
  const show = (next: EditRecordingPage) => {
    if (next === 'name') setLocationName('')
    showPage(next)
  }
  const back = () => show(page === 'name' ? 'location' : 'form')
  // A page sits over the form, so Escape and back leave it before closing the sheet.
  const pageOnTop = useOverlayClaim({ close: back, active: onPage })
  // Heard at window capture, ahead of a field and of the sheet, which closes on Escape.
  useEscapeCapture(back, {
    enabled: onPage,
    when: (event) => !event.defaultPrevented && pageOnTop(),
  })

  // The control pressed to change page leaves with the old page, so focus moves with it: back
  // to the Location row on the form, else to Back unless the new page took it.
  const shownPage = useRef<EditRecordingPage | null>(null)
  const { open } = edit
  useEffect(() => {
    // A sheet that opens shows its page with the dialog's own focus.
    if (!open) {
      shownPage.current = null
      return
    }
    const before = shownPage.current
    shownPage.current = page
    if (before === null || before === page) return
    if (page === 'form') {
      locationRowRef.current?.focus()
      return
    }
    const body = bodyRef.current
    if (body && !body.contains(document.activeElement)) {
      body.closest('[role="dialog"]')?.querySelector<HTMLElement>('header button')?.focus()
    }
  }, [page, open])

  const saveName = () => {
    if (!locationName.trim()) return
    edit.nameLocation(locationName)
    show('form')
  }

  const pageSheet =
    page === 'location'
      ? { title: LOCATION_LABEL, onBack: back, cancel: null, primary: undefined }
      : page === 'name'
        ? {
            title: NAME_LOCATION_TITLE,
            onBack: back,
            cancel: null,
            primary: {
              label: SAVE_LOCATION_NAME,
              onPress: saveName,
              isDisabled: !locationName.trim(),
            },
          }
        : {
            title: EDIT_RECORDING_TITLE,
            onBack: undefined,
            cancel: { onPress: edit.close, isDisabled: edit.pending },
            primary: {
              label: SAVE_RECORDING,
              onPress: edit.save,
              isDisabled: edit.pending || edit.closing,
            },
          }

  return (
    <Sheet
      isOpen={edit.open}
      onOpenChange={(open) => {
        if (!open) edit.close()
      }}
      height="part"
      locked={edit.dirty || edit.pending}
      {...pageSheet}
    >
      <div ref={bodyRef}>
        {page === 'location' ? (
          <LocationPage
            edit={edit}
            settleMs={settleMs}
            onPicked={() => show('form')}
            onName={() => show('name')}
          />
        ) : page === 'name' ? (
          <NameLocationForm
            candidates={namingCandidates(edit.placePoint, edit.savedPlaces)}
            name={locationName}
            onNameChange={setLocationName}
            onPick={(place) => {
              edit.pickSaved(place, { whileNaming: true })
              show('form')
            }}
            onSubmit={saveName}
          />
        ) : (
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
            <Group>
              <SuggestField
                label={PLAYERS_LABEL}
                value={edit.players}
                suggestions={edit.playerSuggestions}
                maxLength={RECORDING_LIMITS.players}
                onChange={edit.setPlayers}
              />
              <AriaButton
                ref={locationRowRef}
                aria-label={locationRowName(edit.place?.name ?? null)}
                onPress={() => show('location')}
                className={FIELD_ROW_PRESSABLE}
              >
                <span className={FIELD_LABEL}>{LOCATION_LABEL}</span>
                <span className={`${FIELD_VALUE_SHAPE} text-ink-2 ph-no-capture`}>
                  {edit.place?.name ?? NOT_SET}
                </span>
                <ChevronRight className="text-ink-2 size-4 shrink-0" aria-hidden />
              </AriaButton>
              {edit.canClearPlace && (
                <ActionRow
                  label={CLEAR_LOCATION}
                  onPress={() => {
                    edit.clearPlace()
                    // The row leaves with the location, so focus stays on the field it cleared.
                    locationRowRef.current?.focus()
                  }}
                />
              )}
            </Group>
            <Group header={NOTES_LABEL}>
              <TextField
                standalone
                multiline
                label={NOTES_LABEL}
                placeholder={RECORDING_NOTES_PLACEHOLDER}
                value={edit.notes}
                maxLength={RECORDING_LIMITS.notes}
                onChange={edit.setNotes}
              />
            </Group>
          </form>
        )}
      </div>
    </Sheet>
  )
}
