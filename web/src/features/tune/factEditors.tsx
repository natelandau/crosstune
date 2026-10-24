import { useEffect, useMemo, useState } from 'react'
import { TIME_SIGNATURES, TUNE_LIMITS, type Instrument } from '../../api/vocabulary'
import { CAPO_INSTRUMENTS, GENRES, PART_STRUCTURES } from '../../constants'
import { tuningKeyInstrument } from '../../domain/instruments'
import { NOT_SET } from '../../ui/fieldCopy'
import { Group } from '../../ui/form/Group'
import { PartialDateField } from '../../ui/form/PartialDateField'
import { Picker } from '../../ui/form/Picker'
import { asOptions } from '../../ui/form/pickerOptions'
import { StatusRail } from '../../ui/form/StatusRail'
import { SuggestField } from '../../ui/form/SuggestField'
import { Switch } from '../../ui/form/Switch'
import { TextField } from '../../ui/form/TextField'
import { KeyGrid } from '../../ui/KeyGrid'
import { KEY } from '../../ui/keyName'
import { useLatest } from '../../ui/useLatest'
import { useCatalog } from '../catalog/useCatalog'
import { DETAIL_LABELS, DETAILS_FOOTER } from './detailFields'
import { useFactEdit, type FactEdit } from './FactEditor'
import type { FactId } from './factRows'
import { suggestionsFor } from './factSuggestions'
import { ModeRows, TuningRows } from './tuneFieldRows'
import { STATUS_HEADER } from './tuneFormCopy'
import {
  asTimeSignature,
  learnedOnError,
  learnedOnParts,
  learnedOnRefusedPart,
  learnedOnText,
  modeRows,
  partModeChanged,
  valuesFromRows,
  type TuneFormValues,
} from './tuneFormValues'
import type { FactWrite } from './useFactWrite'
import type { TuneView } from './useTune'

export interface FactEditorBodyProps {
  id: FactId
  view: TuneView
  write: FactWrite
}

type BodyProps = Pick<FactEditorBodyProps, 'view'> & { edit: FactEdit }

/**
 * The editor for one fact: a pick saves at once and closes, unless the editor holds more to
 * set, such as a capo; typed text is reported as a draft. A body with typed text focuses its
 * first field as it opens.
 */
export function FactEditorBody({ id, view, write }: FactEditorBodyProps) {
  const edit = useFactEdit()
  const instrument = tuningKeyInstrument(id)
  if (instrument) {
    return <TuningBody instrument={instrument} view={view} write={write} edit={edit} />
  }
  switch (id) {
    case 'status':
      return (
        <StatusRail
          label={STATUS_HEADER}
          value={view.userTune.status}
          autoFocus
          onChange={(status) => edit.done({ status })}
        />
      )
    case 'key':
      return <KeyBody view={view} write={write} />
    case 'time_signature':
      return (
        <Picker
          label={DETAIL_LABELS.time_signature}
          value={view.tune.time_signature ?? null}
          options={asOptions(TIME_SIGNATURES)}
          emptyLabel={NOT_SET}
          autoFocus
          onChange={(value) => edit.done({ time_signature: asTimeSignature(value) })}
          onChoose={() => edit.done()}
        />
      )
    case 'is_crooked':
      return <CrookedBody view={view} write={write} />
    case 'learned_on':
      return <LearnedOnBody view={view} edit={edit} />
    case 'alternate_titles':
      return <AlternateTitlesBody view={view} edit={edit} />
    case 'tune_type':
    case 'genre':
    case 'composer':
    case 'learned_from':
      return <SuggestBody field={id} view={view} edit={edit} />
    case 'part_structure':
      return (
        <>
          <SuggestBody field={id} view={view} edit={edit} />
          <Group>
            <CrookedBody view={view} write={write} />
          </Group>
        </>
      )
  }
}

function CrookedBody({ view, write }: Pick<FactEditorBodyProps, 'view' | 'write'>) {
  const [on, setOn] = useState(view.tune.is_crooked)
  return (
    <Switch
      label={DETAIL_LABELS.is_crooked}
      isSelected={on}
      onChange={(next) => {
        setOn(next)
        write.write({ is_crooked: next })
      }}
    />
  )
}

function KeyBody({ view, write }: Pick<FactEditorBodyProps, 'view' | 'write'>) {
  const [key, setKey] = useState(view.tune.key ?? '')
  const [modes, setModes] = useState(() => valuesFromRows(view.tune, view.userTune).modes)
  // Each write carries both, so two quick picks never write one over the other.
  const save = (next: { key?: string; modes?: TuneFormValues['modes'] }) => {
    const patch = { key, modes, ...next }
    if (next.key !== undefined) setKey(next.key)
    if (next.modes) setModes(next.modes)
    write.write(patch)
  }
  return (
    <>
      <Group header={KEY} plain>
        <KeyGrid autoFocus value={key || null} onChange={(picked) => save({ key: picked ?? '' })} />
      </Group>
      <Group>
        <ModeRows
          modes={modes}
          onChange={(index, mode) => save({ modes: partModeChanged(modes, index, mode) })}
          onAdd={() => setModes([...modeRows(modes), ''])}
        />
      </Group>
    </>
  )
}

function TuningBody({
  instrument,
  view,
  write,
  edit,
}: { instrument: Instrument; write: FactWrite } & BodyProps) {
  const [tunings, setTunings] = useState(() => valuesFromRows(view.tune, view.userTune).tunings)
  const entry = tunings[instrument] ?? { tuning: '', capo: '' }
  const change = (patch: Partial<typeof entry>) => {
    const next = { ...tunings, [instrument]: { ...entry, ...patch } }
    setTunings(next)
    edit.onDraft({ tunings: next })
    return next
  }
  return (
    <Group>
      <TuningRows
        instrument={instrument}
        entry={entry}
        autoFocus
        onChange={change}
        onPickTuning={(tuning) => {
          const tunings = change({ tuning })
          // An instrument that takes a capo keeps its editor open for the capo, as Key keeps
          // its open for the modes.
          if (CAPO_INSTRUMENTS[instrument]) write.write({ tunings })
          else edit.done({ tunings })
        }}
      />
    </Group>
  )
}

type SuggestFact = 'tune_type' | 'genre' | 'composer' | 'part_structure' | 'learned_from'

function SuggestBody({ field, view, edit }: { field: SuggestFact } & BodyProps) {
  const catalog = useCatalog()
  const [value, setValue] = useState(() => valuesFromRows(view.tune, view.userTune)[field])
  const genre = view.tune.genre ?? ''
  const suggestions = useMemo(() => suggestionsFor(genre, catalog ?? []), [genre, catalog])
  const options: Record<SuggestFact, readonly string[]> = {
    tune_type: suggestions.types,
    genre: GENRES,
    composer: suggestions.composers,
    part_structure: PART_STRUCTURES,
    learned_from: suggestions.learnedFrom,
  }
  return (
    <Group>
      <SuggestField
        label={DETAIL_LABELS[field]}
        value={value}
        suggestions={options[field]}
        maxLength={TUNE_LIMITS[field]}
        autoFocus
        onChange={(next) => {
          setValue(next)
          edit.onDraft({ [field]: next })
        }}
        onPick={(picked) => edit.done({ [field]: picked })}
      />
    </Group>
  )
}

function AlternateTitlesBody({ view, edit }: BodyProps) {
  const [value, setValue] = useState(view.tune.alternate_titles.join(', '))
  return (
    <Group footer={DETAILS_FOOTER}>
      <TextField
        label={DETAIL_LABELS.alternate_titles}
        value={value}
        autoFocus
        onChange={(next) => {
          setValue(next)
          edit.onDraft({ alternate_titles: next })
        }}
      />
    </Group>
  )
}

function LearnedOnBody({ view, edit }: BodyProps) {
  const [text, setText] = useState(view.userTune.learned_on ?? '')
  // The reason shows once the player leaves the date, so typing a year never flashes it.
  const [left, setLeft] = useState(false)
  const error = left ? learnedOnError(text) : null
  const textRef = useLatest(text)
  // Enter on a date still missing a part says why and stays; a dismissal discards it.
  useEffect(() => {
    edit.holdEnter(() => {
      const refused = learnedOnError(textRef.current) !== null
      if (refused) setLeft(true)
      return refused
    })
    return () => edit.holdEnter(null)
  }, [edit, textRef])
  return (
    <Group error={error ?? undefined}>
      <PartialDateField
        whole
        autoFocus
        value={learnedOnParts(text)}
        refusedPart={error ? learnedOnRefusedPart(text) : null}
        onLeave={() => setLeft(true)}
        onChange={(parts) => {
          const next = learnedOnText(parts)
          setText(next)
          setLeft(false)
          // A partial date is never saved, and none is invented.
          edit.onDraft(learnedOnError(next) ? null : { learned_on: next })
        }}
      />
    </Group>
  )
}
