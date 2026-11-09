import { useId, useMemo, useState, type Ref } from 'react'
import { RECORDING_LIMITS } from '../../api/vocabulary'
import { isRecordingPrecision } from '../../db/types'
import { blankToNull } from '../../text/blank'
import { recordedTime } from '../../text/format'
import { AttributesColumn } from '../../ui/attributes/AttributesColumn'
import {
  useAttributeEdit,
  useEnterKey,
  type AttributeEdit,
} from '../../ui/attributes/AttributeEditor'
import { NOT_SET } from '../../ui/fieldCopy'
import { ButtonRow } from '../../ui/form/ButtonRow'
import { Group } from '../../ui/form/Group'
import { PartialDateField } from '../../ui/form/PartialDateField'
import { SuggestField } from '../../ui/form/SuggestField'
import { TextField } from '../../ui/form/TextField'
import { LocationMap } from '../../ui/LocationMap'
import { sameParts, type DateParts } from '../../ui/partialDate'
import { SEARCH_TUNES } from '../catalog/catalogCopy'
import { recordingPlayers } from '../recordings/place'
import { datePatch, partsOf } from '../recordings/recordedDateParts'
import { RECORDING_NAME_LABEL, recordedAtNote } from '../recordings/recordingCopy'
import {
  addToTuneName,
  NOTES_LABEL,
  PLAYERS_LABEL,
  RECORDING_NAME_PLACEHOLDER,
  RECORDING_NOTES_PLACEHOLDER,
} from '../recordings/recordingsCopy'
import { TuneSearchList } from '../recordings/TuneSearchList'
import { useAllRecordings } from '../recordings/useAllRecordings'
import { useFileRecording } from '../recordings/useFileRecording'
import type { RecordingView } from '../recordings/useRecordings'
import { LocationEditor } from './location/LocationEditor'
import { DETAILS, LINKED_TUNE_LABEL, REMOVE_FROM_TUNE } from './recordingPageCopy'
import { RECORDING_GROUPS, recordingRows, type RecordingAttributeId } from './recordingRows'
import { useRecordingAttributeWrite, type RecordingPatch } from './useRecordingAttributeWrite'
import type { RecordingLocation } from './useRecordingPageView'

type Edit = AttributeEdit<RecordingPatch>

/** The values each row's editor compares its draft with. */
function storedPatch(view: RecordingView): Required<RecordingPatch> {
  const { recording } = view
  return {
    label: recording.label ?? null,
    // The tune the row shows, so a recording under a tune deleted elsewhere files from it.
    tune_id: view.tuneId,
    players: recording.players ?? null,
    notes: recording.notes ?? null,
    recorded_at: recording.recorded_at,
    recorded_precision: isRecordingPrecision(recording.recorded_precision)
      ? recording.recorded_precision
      : null,
  }
}

/**
 * A recording's attributes, as the column beside practice or as Details' card: each row opens
 * its own editor, which saves on every dismissal but Escape. The location editor opens from its
 * row or from the map under it.
 */
export function RecordingAttributes({
  ref,
  view,
  location,
  layout,
}: {
  ref?: Ref<HTMLElement>
  view: RecordingView
  location: RecordingLocation | null
  layout: 'column' | 'card'
}) {
  const write = useRecordingAttributeWrite(view.recording.id)
  const [openId, setOpenId] = useState<string | null>(null)
  return (
    <AttributesColumn
      ref={ref}
      label={DETAILS}
      layout={layout}
      groups={RECORDING_GROUPS}
      rows={recordingRows(view, {
        below: location && (
          <LocationBelow location={location} onPress={() => setOpenId('location')} />
        ),
        editor: ({ isOpen, onClose, onClosed, onWrite }) => (
          <LocationEditor
            view={view}
            isOpen={isOpen}
            onOpenChange={(open) => {
              if (!open) onClose()
            }}
            onClosed={onClosed}
            run={(save) => {
              onWrite()
              void write.run(save)
            }}
          />
        ),
      })}
      emptyText={NOT_SET}
      stored={storedPatch(view)}
      onCommit={(patch) => void write.write(patch)}
      editorFor={(row) => <RecordingEditorBody id={row.id} view={view} />}
      sheetFor={(row) => row.id === 'tune'}
      error={write.error}
      openId={openId}
      onOpenIdChange={setOpenId}
    />
  )
}

/**
 * The map of where the recording was made, and a saved location's address under it. A press on
 * the map opens the location editor; the row above it is the way in for the keyboard.
 */
function LocationBelow({
  location: { point, address },
  onPress,
}: {
  location: RecordingLocation
  onPress: () => void
}) {
  return (
    <div className="flex flex-col gap-1 px-4 pt-1 pb-3">
      <div data-location-map className="cursor-default" onClick={onPress}>
        <LocationMap lat={point.lat} lon={point.lon} accuracyM={point.accuracyM} />
      </div>
      {address && <p className="t-secondary text-secondary ph-no-capture">{address}</p>}
    </div>
  )
}

/** The body of the editor one row opens. Typed text is a draft; a pick saves and closes. */
function RecordingEditorBody({ id, view }: { id: RecordingAttributeId; view: RecordingView }) {
  const edit = useAttributeEdit<RecordingPatch>()
  switch (id) {
    case 'name':
      return <NameBody view={view} edit={edit} />
    case 'tune':
      return <TuneBody view={view} edit={edit} />
    case 'players':
      return <PlayersBody view={view} edit={edit} />
    case 'recorded':
      return <RecordedBody view={view} edit={edit} />
    case 'notes':
      return <NotesBody view={view} edit={edit} />
    case 'added':
    case 'location':
      return null
  }
}

interface BodyProps {
  view: RecordingView
  edit: Edit
}

function NameBody({ view, edit }: BodyProps) {
  const [value, setValue] = useState(view.recording.label ?? '')
  useEnterKey()
  return (
    <Group>
      <TextField
        standalone
        label={RECORDING_NAME_LABEL}
        placeholder={RECORDING_NAME_PLACEHOLDER}
        value={value}
        maxLength={RECORDING_LIMITS.label}
        enterKeyHint="done"
        autoFocus
        onChange={(next) => {
          setValue(next)
          edit.onDraft({ label: blankToNull(next) })
        }}
      />
    </Group>
  )
}

function TuneBody({ view, edit }: BodyProps) {
  // Enter in the search picks or creates through the list, never as a dismissal.
  const file = useFileRecording(view.recording.id, 'recording_screen')
  return (
    <>
      {view.tuneId && (
        <Group>
          <ButtonRow
            title={LINKED_TUNE_LABEL}
            button={{
              label: REMOVE_FROM_TUNE,
              variant: 'destructive',
              onPress: () => edit.done({ tune_id: null }),
            }}
          />
        </Group>
      )}
      <TuneSearchList
        label={SEARCH_TUNES}
        query={file.query}
        onQuery={file.setQuery}
        matches={file.matches}
        onPick={(entry) => edit.done({ tune_id: entry.tune.id })}
        onCreate={(title) => {
          edit.done()
          file.create(title)
        }}
        rowName={addToTuneName}
      />
    </>
  )
}

function PlayersBody({ view, edit }: BodyProps) {
  const recordings = useAllRecordings()
  const suggestions = useMemo(() => recordingPlayers(recordings ?? []), [recordings])
  const [value, setValue] = useState(view.recording.players ?? '')
  useEnterKey()
  return (
    <Group>
      <SuggestField
        label={PLAYERS_LABEL}
        value={value}
        suggestions={suggestions}
        maxLength={RECORDING_LIMITS.players}
        autoFocus
        onChange={(next) => {
          setValue(next)
          edit.onDraft({ players: blankToNull(next) })
        }}
        onPick={(picked) => edit.done({ players: blankToNull(picked) })}
      />
    </Group>
  )
}

/** Why the date cannot be saved, or null when it can. */
function refusalOf(parts: DateParts): string | null {
  const patch = datePatch(parts)
  return 'error' in patch ? patch.error : null
}

function RecordedBody({ view, edit }: BodyProps) {
  const { recorded_at: at, recorded_precision: precision } = view.recording
  const known = isRecordingPrecision(precision) ? precision : null
  const [opened] = useState(() => partsOf(at, known))
  const [parts, setParts] = useState<DateParts>(opened)
  // The reason shows once the musician leaves the date, so typing a year never flashes it.
  const [left, setLeft] = useState(false)
  const errorId = useId()
  const error = left ? refusalOf(parts) : null
  const unchanged = sameParts(parts, opened)
  // An exact time survives only while the date parts are left alone.
  const timeNote = at && known === 'time' && unchanged ? recordedAtNote(recordedTime(at)) : null
  // Enter on a date that cannot be saved says why and stays; a dismissal discards it.
  useEnterKey(() => {
    if (refusalOf(parts) === null) edit.done()
    else setLeft(true)
  })
  return (
    <Group error={error ?? undefined} errorId={errorId} footer={timeNote ?? undefined}>
      <PartialDateField
        autoFocus
        value={parts}
        refusedPart={error ? 'year' : null}
        describedBy={errorId}
        onLeave={() => setLeft(true)}
        onChange={(next) => {
          setParts(next)
          setLeft(false)
          const patch = datePatch(next)
          edit.onDraft(sameParts(next, opened) || 'error' in patch ? null : patch)
        }}
      />
    </Group>
  )
}

function NotesBody({ view, edit }: BodyProps) {
  const [value, setValue] = useState(view.recording.notes ?? '')
  return (
    <Group>
      <TextField
        standalone
        multiline
        label={NOTES_LABEL}
        placeholder={RECORDING_NOTES_PLACEHOLDER}
        value={value}
        maxLength={RECORDING_LIMITS.notes}
        autoFocus
        onChange={(next) => {
          setValue(next)
          edit.onDraft({ notes: blankToNull(next) })
        }}
      />
    </Group>
  )
}
