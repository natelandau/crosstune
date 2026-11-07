import type { ReactNode } from 'react'
import { addedDay, knownRecordedDate } from '../../text/format'
import type { AttributeColumnRow, AttributeGroup } from '../../ui/attributes/AttributesColumn'
import {
  LOCATION_LABEL,
  NAME_LABEL,
  NOTES_LABEL,
  PLAYERS_LABEL,
} from '../recordings/recordingsCopy'
import type { RecordingView } from '../recordings/useRecordings'
import { RECORDED_HEADER } from '../stats/copy'
import { ADDED_LABEL, DETAILS, LINKED_TUNE_LABEL } from './recordingPageCopy'

export type RecordingAttributeId =
  'name' | 'players' | 'recorded' | 'added' | 'tune' | 'location' | 'notes'

export interface RecordingAttributeRow extends AttributeColumnRow {
  id: RecordingAttributeId
}

export const RECORDING_GROUPS: AttributeGroup[] = [
  { id: 'details', heading: DETAILS },
  { id: 'place' },
  { id: 'notes' },
]

/**
 * A recording's attribute rows, in the order every layout shows them: its details, its
 * location with `location.below`, such as a map, set under the row, then its notes. The
 * location row opens `location.editor`.
 */
export function recordingRows(
  view: RecordingView,
  location: { below: ReactNode; editor: NonNullable<AttributeColumnRow['ownEditor']> },
): RecordingAttributeRow[] {
  const { recording } = view
  return [
    { id: 'name', label: NAME_LABEL, text: recording.label || null, group: 'details' },
    { id: 'players', label: PLAYERS_LABEL, text: recording.players || null, group: 'details' },
    {
      id: 'recorded',
      label: RECORDED_HEADER,
      text: knownRecordedDate(recording),
      group: 'details',
    },
    {
      id: 'added',
      label: ADDED_LABEL,
      text: addedDay(recording.added_at),
      group: 'details',
      readOnly: true,
    },
    { id: 'tune', label: LINKED_TUNE_LABEL, text: view.tuneTitle, group: 'details' },
    {
      id: 'location',
      label: LOCATION_LABEL,
      text: view.shownPlace ?? null,
      group: 'place',
      ownEditor: location.editor,
      below: location.below,
    },
    { id: 'notes', label: NOTES_LABEL, text: recording.notes || null, group: 'notes' },
  ]
}
