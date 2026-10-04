import { IonButton, IonInput, IonItem, IonLabel, IonSelect, IonSelectOption } from '@ionic/react'
import { useEffect, useRef, useState } from 'react'
import { RECORDING_LIMITS } from '../../api/vocabulary'
import { updateRecording } from '../../commands/recordings'
import { useDb } from '../../db/DbProvider'
import { isRecordingPrecision } from '../../db/types'
import { usePointer } from '../../platform/pointer'
import { CANCEL } from '../../ui/Confirm'
import { FieldRow, NOT_SET } from '../../ui/FieldRow'
import { Group } from '../../ui/Group'
import { Sheet } from '../../ui/Sheet'
import { useAction } from '../../ui/useAction'
import { useSheetSession } from '../../ui/useSheetSession'
import { recordedTime } from '../recording/format'
import { RECORDING_NAME_LABEL, recordedAtNote } from './recordingCopy'
import {
  datePatch,
  type DateParts,
  dayCount,
  isFullYear,
  NO_DATE,
  partsOf,
  sameParts,
  type StoredDate,
} from './recordedDateParts'
import type { RecordingView } from './useRecordings'

const MONTHS = Array.from({ length: 12 }, (_, index) => String(index + 1))
const MONTH_NAME = new Intl.DateTimeFormat(undefined, { month: 'long', timeZone: 'UTC' })
const MONTH_LABELS = MONTHS.map((month) => MONTH_NAME.format(Date.UTC(2000, Number(month) - 1)))

export const RECORDING_NAME_PLACEHOLDER = 'Jam at Tom’s, take 2, …'
export const EDIT_RECORDING_TITLE = 'Edit recording'
export const NAME_LABEL = 'Name'
export const DATE_RECORDED_LABEL = 'Date recorded'
export const YEAR_LABEL = 'Year'
export const MONTH_LABEL = 'Month'
export const DAY_LABEL = 'Day'
export const ANY_LABEL = 'Any'
export const CLEAR_DATE = 'Clear date'

/**
 * A recording's name and the date it was recorded. The date is a year, optionally narrowed to
 * a month and a day; a take's exact time survives only while its date parts are left alone.
 */
export function EditRecordingSheet({
  view,
  onClose,
}: {
  /** The recording to edit, or null for a closed sheet; the parent nulls it from onClose. */
  view: RecordingView | null
  onClose: () => void
}) {
  const db = useDb()
  const mouse = usePointer() === 'mouse'
  const { error, pending, runThen, clear } = useAction()
  const [name, setName] = useState('')
  const [parts, setParts] = useState<DateParts>(NO_DATE)
  const [openedParts, setOpenedParts] = useState<DateParts>(NO_DATE)
  const [openedTime, setOpenedTime] = useState<string | null>(null)
  const [dateError, setDateError] = useState<string | null>(null)
  const yearRef = useRef<HTMLIonInputElement>(null)
  // The stored values on open, whatever a cancelled edit left in the fields.
  const sheet = useSheetSession(view, {
    onOpen: (opened) => {
      const { label, recorded_at: at, recorded_precision: precision } = opened.recording
      const known = isRecordingPrecision(precision) ? precision : null
      const start = partsOf(at, known)
      setName(label ?? '')
      setParts(start)
      setOpenedParts(start)
      setOpenedTime(at && known === 'time' ? recordedTime(at) : null)
      setDateError(null)
      clear()
    },
    onClose,
  })

  // Ionic copies aria-* onto the native input only while it loads, so a later state is written
  // on the input itself.
  useEffect(() => {
    const input = yearRef.current?.querySelector('input')
    if (!input) return
    if (dateError) input.setAttribute('aria-invalid', 'true')
    else input.removeAttribute('aria-invalid')
  }, [dateError])

  const dateUnchanged = sameParts(parts, openedParts)
  const monthEnabled = isFullYear(parts.year)
  const dayEnabled = monthEnabled && parts.month !== ''

  const editParts = (patch: Partial<DateParts>) => {
    setDateError(null)
    setParts((current) => {
      const next = { ...current, ...patch }
      // A day only narrows a month, and one the new month or year lacks reads as Any rather
      // than rolling over.
      if (!next.month) next.day = ''
      else if (Number(next.day) > dayCount(next)) next.day = ''
      return next
    })
  }

  const save = () => {
    // Enter reaches this through the hidden submit button, which the toolbar's disabled state
    // does not cover.
    if (!view || !sheet.canSave()) return
    const label = name.trim() || null
    let date: StoredDate | undefined
    if (!dateUnchanged) {
      const patch = datePatch(parts)
      if ('error' in patch) {
        clear()
        setDateError(patch.error)
        void yearRef.current?.setFocus()
        return
      }
      date = patch
    }
    sheet.beginSave()
    runThen(async () => {
      await updateRecording(db, view.recording.id, { label, ...date }).catch(sheet.saveFailed)
    }, sheet.close)
  }

  const interfaceFor = (label: string) => ({
    interface: mouse ? ('popover' as const) : ('action-sheet' as const),
    interfaceOptions: { header: label },
  })

  return (
    <Sheet
      open={sheet.open}
      title={EDIT_RECORDING_TITLE}
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
        className="pb-8"
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        <button type="submit" tabIndex={-1} aria-hidden="true" className="sr-only" />
        <Group header={NAME_LABEL} error={error}>
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
        <Group
          header={DATE_RECORDED_LABEL}
          error={dateError}
          footer={openedTime && dateUnchanged ? recordedAtNote(openedTime) : undefined}
        >
          <FieldRow label={YEAR_LABEL}>
            <IonInput
              ref={yearRef}
              aria-label={YEAR_LABEL}
              placeholder={NOT_SET}
              inputmode="numeric"
              maxlength={4}
              value={parts.year}
              enterkeyhint="done"
              onIonInput={(event) => editParts({ year: String(event.detail.value ?? '').trim() })}
            />
          </FieldRow>
          <FieldRow label={MONTH_LABEL}>
            <IonSelect
              aria-label={MONTH_LABEL}
              {...interfaceFor(MONTH_LABEL)}
              disabled={!monthEnabled}
              value={parts.month}
              onIonChange={(event) => editParts({ month: String(event.detail.value ?? '') })}
            >
              <IonSelectOption value="">{ANY_LABEL}</IonSelectOption>
              {MONTHS.map((month, index) => (
                <IonSelectOption key={month} value={month}>
                  {MONTH_LABELS[index]}
                </IonSelectOption>
              ))}
            </IonSelect>
          </FieldRow>
          <FieldRow label={DAY_LABEL}>
            <IonSelect
              aria-label={DAY_LABEL}
              {...interfaceFor(DAY_LABEL)}
              disabled={!dayEnabled}
              value={parts.day}
              onIonChange={(event) => editParts({ day: String(event.detail.value ?? '') })}
            >
              <IonSelectOption value="">{ANY_LABEL}</IonSelectOption>
              {/* Kept while Day is disabled, so a chosen day still shows its value. */}
              {Array.from({ length: dayCount(parts) }, (_, index) => (
                <IonSelectOption key={index + 1} value={String(index + 1)}>
                  {index + 1}
                </IonSelectOption>
              ))}
            </IonSelect>
          </FieldRow>
          <IonItem
            button
            detail={false}
            disabled={sameParts(parts, NO_DATE)}
            onClick={() => editParts(NO_DATE)}
          >
            <IonLabel color="primary">{CLEAR_DATE}</IonLabel>
          </IonItem>
        </Group>
      </form>
    </Sheet>
  )
}
