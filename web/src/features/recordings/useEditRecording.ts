import { useState } from 'react'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import { recordingOrigin } from '../../usage/origin'
import { updateRecording } from '../../commands/recordings'
import { useDb } from '../../db/DbProvider'
import { isRecordingPrecision } from '../../db/types'
import { isFullYear, narrowedParts, NO_DATE, sameParts, type DateParts } from '../../ui/partialDate'
import { useAction } from '../../ui/useAction'
import { useSheetSession } from '../../ui/useSheetSession'
import { recordedTime } from '../../text/format'
import { recordedAtNote } from './recordingCopy'
import { datePatch, partsOf, type StoredDate } from './recordedDateParts'
import type { RecordingView } from './useRecordings'

export interface EditRecording {
  /** Whether the sheet shows. */
  open: boolean
  /** Cancel or a save asked the sheet to close. */
  closing: boolean
  name: string
  /** Sets the name and drops the last save's refusal. */
  setName: (name: string) => void
  parts: DateParts
  /** Narrows the date: a day needs a month, and a month needs a full year. */
  editParts: (patch: Partial<DateParts>) => void
  monthEnabled: boolean
  dayEnabled: boolean
  /** Whether there is a date for Clear date to clear. */
  canClearDate: boolean
  clearDate: () => void
  /** The take's exact time, shown only while its date parts are left alone. */
  timeNote: string | null
  dateError: string | null
  /** The last save's refusal. */
  error: string | null
  pending: boolean
  /** Whether the name or date differs from what the sheet opened with. */
  dirty: boolean
  save: () => void
  close: () => void
  /** The sheet's onClose, run once its dismissal ends. */
  dismissed: () => void
}

/**
 * A recording's name and the date it was recorded. The date is a year, optionally narrowed to
 * a month and a day; a take's exact time survives only while its date parts are left alone.
 * `view` is null for a closed sheet; the parent nulls it from `onClose`.
 */
export function useEditRecording(
  view: RecordingView | null,
  {
    onClose,
    onDateError,
  }: {
    onClose: () => void
    /** Runs when a save is refused for its date, to move focus to the year. */
    onDateError?: () => void
  },
): EditRecording {
  const db = useDb()
  const analytics = useAnalytics()
  const { error, pending, runThen, clear } = useAction()
  const [name, setNameState] = useState('')
  const [openedName, setOpenedName] = useState('')
  const [parts, setParts] = useState<DateParts>(NO_DATE)
  const [openedParts, setOpenedParts] = useState<DateParts>(NO_DATE)
  const [openedTime, setOpenedTime] = useState<string | null>(null)
  const [dateError, setDateError] = useState<string | null>(null)
  // The stored values on open, whatever a cancelled edit left in the fields.
  const sheet = useSheetSession(view, {
    onOpen: (opened) => {
      const { label, recorded_at: at, recorded_precision: precision } = opened.recording
      const known = isRecordingPrecision(precision) ? precision : null
      const start = partsOf(at, known)
      setNameState(label ?? '')
      setOpenedName(label ?? '')
      setParts(start)
      setOpenedParts(start)
      setOpenedTime(at && known === 'time' ? recordedTime(at) : null)
      setDateError(null)
      clear()
    },
    onClose,
  })

  const dateUnchanged = sameParts(parts, openedParts)
  const monthEnabled = isFullYear(parts.year)

  const setName = (next: string) => {
    setNameState(next)
    clear()
  }

  const editParts = (patch: Partial<DateParts>) => {
    setDateError(null)
    setParts((current) => narrowedParts(current, patch))
  }

  const save = () => {
    // Enter reaches this through a form submit, which a disabled Save does not cover.
    if (!view || !sheet.canSave()) return
    const label = name.trim() || null
    let date: StoredDate | undefined
    if (!dateUnchanged) {
      const patch = datePatch(parts)
      if ('error' in patch) {
        clear()
        setDateError(patch.error)
        onDateError?.()
        return
      }
      date = patch
    }
    sheet.beginSave()
    runThen(async () => {
      await updateRecording(db, view.recording.id, { label, ...date }).catch(sheet.saveFailed)
      if (label !== (view.recording.label ?? null)) {
        analytics.send('recording_renamed', {
          origin: recordingOrigin(view.recording),
          recording_id: view.recording.id,
        })
      }
    }, sheet.close)
  }

  return {
    open: sheet.open,
    closing: sheet.closing,
    name,
    setName,
    parts,
    editParts,
    monthEnabled,
    dayEnabled: monthEnabled && parts.month !== '',
    canClearDate: !sameParts(parts, NO_DATE),
    clearDate: () => editParts(NO_DATE),
    timeNote: openedTime && dateUnchanged ? recordedAtNote(openedTime) : null,
    dateError,
    error,
    pending,
    dirty: name !== openedName || !dateUnchanged,
    save,
    close: sheet.close,
    dismissed: sheet.dismissed,
  }
}
