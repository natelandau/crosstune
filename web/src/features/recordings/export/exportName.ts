import type { RecordingPrecision } from '../../../api/vocabulary'
import { isRecordingPrecision } from '../../../db/types'
import { audioExtension, formatDate } from '../../settings/export/buildExport'
import { NameAllocator } from '../../settings/export/safeName'
import { recordingTitle, titleIsDate } from '../recordingRow'
import type { RecordingView } from '../useRecordings'

export interface NameInput {
  title: string
  titleIsDate: boolean
  recordedAt: string | null
  precision: RecordingPrecision | null
  contentType: string | null
}

function datePart(recordedAt: string, precision: RecordingPrecision, timeZone: string): string {
  const instant = new Date(recordedAt)
  if (precision === 'time') return formatDate(instant, timeZone)
  const iso = instant.toISOString()
  if (precision === 'day') return iso.slice(0, 10)
  if (precision === 'month') return iso.slice(0, 7)
  return iso.slice(0, 4)
}

/** The file name without its extension: the title, then the recorded date unless the title is it. */
export function fileStem(input: Omit<NameInput, 'contentType'>, timeZone: string): string {
  if (input.titleIsDate || !input.recordedAt || !input.precision) return input.title
  return `${input.title} ${datePart(input.recordedAt, input.precision, timeZone)}`
}

/** One unique file name per input, in order. */
export function fileNames(inputs: readonly NameInput[], timeZone: string): string[] {
  const names = new NameAllocator()
  return inputs.map((input) =>
    names.take(fileStem(input, timeZone), audioExtension(input.contentType)),
  )
}

export function nameInput(view: RecordingView, contentType: string | null): NameInput {
  const { recorded_at, recorded_precision } = view.recording
  const known = recorded_at && isRecordingPrecision(recorded_precision)
  return {
    title: recordingTitle(view),
    titleIsDate: titleIsDate(view),
    recordedAt: known ? recorded_at : null,
    precision: known ? recorded_precision : null,
    contentType,
  }
}
