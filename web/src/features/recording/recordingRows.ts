import type { ReactNode } from 'react'
import { knownRecordedDate } from '../../text/format'
import type { AttributeColumnRow, AttributeGroup } from '../../ui/attributes/AttributesColumn'
import {
  LOCATION_LABEL,
  NAME_LABEL,
  NOTES_LABEL,
  PLAYERS_LABEL,
} from '../recordings/recordingsCopy'
import type { RecordingView } from '../recordings/useRecordings'
import { RECORDED_HEADER } from '../stats/copy'
import { DETAILS, LINKED_TUNE_LABEL } from './recordingPageCopy'

export type RecordingAttributeId = 'name' | 'players' | 'recorded' | 'tune' | 'location' | 'notes'

export interface RecordingAttributeRow extends AttributeColumnRow {
  id: RecordingAttributeId
}

export const RECORDING_GROUPS: AttributeGroup[] = [
  { id: 'details', heading: DETAILS },
  { id: 'place' },
  { id: 'notes' },
]

type OwnEditor = NonNullable<AttributeColumnRow['ownEditor']>

/**
 * A recording's attribute rows, in the order every layout shows them: its details, its
 * location with `location.below`, such as a map, set under the row, then its notes. The
 * tune row opens `tune` and the location row `location.editor`.
 */
export function recordingRows(
  view: RecordingView,
  { tune, location }: { tune: OwnEditor; location: { below: ReactNode; editor: OwnEditor } },
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
      id: 'tune',
      label: LINKED_TUNE_LABEL,
      text: view.tuneTitle,
      group: 'details',
      ownEditor: tune,
    },
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
