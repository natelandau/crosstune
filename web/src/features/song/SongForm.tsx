import { useState, type FormEvent } from 'react'
import type { SongInput, UserSongInput } from '../../commands/songs'
import { useAction } from '../../components/useAction'
import {
  MODES,
  TIME_SIGNATURES,
  type Instrument,
  type LocalSong,
  type LocalUserSong,
  type Mode,
  type SongStatus,
  type TimeSignature,
} from '../../db/types'
import { isSongStatus } from '../catalog/StatusBadge'
import { TUNING_FIELDS, visibleTunings } from '../settings/instruments'
import { SONG_LIMITS } from './limits'
import { StatusPicker } from './StatusPicker'
import { FEELS, GENRES, KEYS, PART_STRUCTURES, TUNING_SUGGESTIONS } from './suggestions'

export interface SongFormValues {
  title: string
  alternate_titles: string
  key: string
  mode: Mode | ''
  violin_tuning: string
  banjo_tuning: string
  genre: string
  feel: string
  part_structure: string
  time_signature: TimeSignature | ''
  is_crooked: boolean
  has_lyrics: boolean
  status: SongStatus
  learned_from: string
  learned_on: string
  notes: string
}

// eslint-disable-next-line react-refresh/only-export-components
export function emptyValues(): SongFormValues {
  return {
    title: '',
    alternate_titles: '',
    key: '',
    mode: '',
    violin_tuning: '',
    banjo_tuning: '',
    genre: '',
    feel: '',
    part_structure: '',
    time_signature: '4/4',
    is_crooked: false,
    has_lyrics: false,
    status: 'want_to_learn',
    learned_from: '',
    learned_on: '',
    notes: '',
  }
}

// A server row can carry a facet value from a schema version this client predates;
// fall back rather than trust it as one of this client's known options.
const asMode = (value: string | null | undefined): Mode | '' =>
  (MODES as readonly string[]).includes(value ?? '') ? (value as Mode) : ''

const asTimeSignature = (value: string | null | undefined): TimeSignature | '' =>
  (TIME_SIGNATURES as readonly string[]).includes(value ?? '') ? (value as TimeSignature) : ''

// eslint-disable-next-line react-refresh/only-export-components
export function valuesFromRows(song: LocalSong, userSong: LocalUserSong): SongFormValues {
  return {
    title: song.title,
    alternate_titles: song.alternate_titles.join(', '),
    key: song.key ?? '',
    mode: asMode(song.mode),
    violin_tuning: song.violin_tuning ?? '',
    banjo_tuning: song.banjo_tuning ?? '',
    genre: song.genre ?? '',
    feel: song.feel ?? '',
    part_structure: song.part_structure ?? '',
    time_signature: asTimeSignature(song.time_signature),
    is_crooked: song.is_crooked,
    has_lyrics: song.has_lyrics ?? false,
    status: isSongStatus(userSong.status) ? userSong.status : 'want_to_learn',
    learned_from: userSong.learned_from ?? '',
    learned_on: userSong.learned_on ?? '',
    notes: userSong.notes ?? '',
  }
}

const blankToNull = (value: string): string | null => (value.trim() ? value.trim() : null)

// eslint-disable-next-line react-refresh/only-export-components
export function inputsFromValues(values: SongFormValues): {
  song: SongInput
  userSong: UserSongInput
} {
  return {
    song: {
      title: values.title.trim(),
      alternate_titles: values.alternate_titles
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      key: blankToNull(values.key),
      mode: values.mode || null,
      violin_tuning: blankToNull(values.violin_tuning),
      banjo_tuning: blankToNull(values.banjo_tuning),
      genre: blankToNull(values.genre),
      feel: blankToNull(values.feel),
      part_structure: blankToNull(values.part_structure),
      time_signature: values.time_signature || null,
      is_crooked: values.is_crooked,
      has_lyrics: values.has_lyrics,
    },
    userSong: {
      status: values.status,
      learned_from: blankToNull(values.learned_from),
      learned_on: values.learned_on || null,
      notes: blankToNull(values.notes),
    },
  }
}

interface Props {
  initial?: SongFormValues
  submitLabel: string
  onSubmit: (song: SongInput, userSong: UserSongInput) => Promise<void>
  onCancel?: () => void
  instruments: ReadonlySet<Instrument>
}

function TextField({
  label,
  name,
  value,
  onChange,
  suggestions,
  type = 'text',
  maxLength,
}: {
  label: string
  name: string
  value: string
  onChange: (value: string) => void
  suggestions?: string[]
  type?: string
  maxLength?: number
}) {
  const listId = suggestions ? `${name}-suggestions` : undefined
  return (
    <fieldset className="fieldset">
      <legend className="fieldset-legend">{label}</legend>
      <label className="input w-full">
        <input
          className="grow"
          type={type}
          name={name}
          aria-label={label}
          value={value}
          list={listId}
          maxLength={maxLength}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      {suggestions ? (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}
    </fieldset>
  )
}

function SelectField<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: Value | ''
  options: readonly Value[]
  onChange: (value: Value | '') => void
}) {
  return (
    <fieldset className="fieldset">
      <legend className="fieldset-legend">{label}</legend>
      <select
        className="select w-full"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as Value | '')}
      >
        <option value="">Not set</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </fieldset>
  )
}

export function SongForm({ initial, submitLabel, onSubmit, onCancel, instruments }: Props) {
  const [values, setValues] = useState<SongFormValues>(initial ?? emptyValues())
  const [validation, setValidation] = useState<string | null>(null)
  const { error: rejection, pending, run } = useAction()
  const error = validation ?? rejection
  const set = <K extends keyof SongFormValues>(key: K, value: SongFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }))
  // Decided once, like `values`: a field must not vanish mid-edit when its text is cleared
  // or the instrument list changes elsewhere, since whatever it holds is still submitted.
  const [tunings] = useState(() =>
    visibleTunings(
      instruments,
      initial
        ? {
            violin_tuning: initial.violin_tuning || null,
            banjo_tuning: initial.banjo_tuning || null,
          }
        : null,
    ),
  )

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const { song, userSong } = inputsFromValues(values)
    if (!song.title) {
      setValidation('A title is required')
      return
    }
    setValidation(null)
    run(() => onSubmit(song, userSong))
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2" noValidate>
      <TextField
        label="Title"
        name="title"
        value={values.title}
        onChange={(v) => set('title', v)}
        maxLength={SONG_LIMITS.title}
      />
      <TextField
        label="Alternate titles"
        name="alternate_titles"
        value={values.alternate_titles}
        onChange={(v) => set('alternate_titles', v)}
      />
      <div className="grid grid-cols-2 gap-2">
        <TextField
          label="Key"
          name="key"
          value={values.key}
          onChange={(v) => set('key', v)}
          maxLength={SONG_LIMITS.key}
          suggestions={KEYS}
        />
        <SelectField
          label="Mode"
          value={values.mode}
          options={MODES}
          onChange={(v) => set('mode', v)}
        />
      </div>
      {tunings.map((field) => (
        <TextField
          key={field}
          label={TUNING_FIELDS[field].label}
          name={field}
          value={values[field]}
          onChange={(v) => set(field, v)}
          maxLength={SONG_LIMITS[field]}
          suggestions={TUNING_SUGGESTIONS[field]}
        />
      ))}
      <div className="grid grid-cols-2 gap-2">
        <TextField
          label="Genre"
          name="genre"
          value={values.genre}
          onChange={(v) => set('genre', v)}
          maxLength={SONG_LIMITS.genre}
          suggestions={GENRES}
        />
        <TextField
          label="Feel"
          name="feel"
          value={values.feel}
          onChange={(v) => set('feel', v)}
          maxLength={SONG_LIMITS.feel}
          suggestions={FEELS}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <SelectField
          label="Time signature"
          value={values.time_signature}
          options={TIME_SIGNATURES}
          onChange={(v) => set('time_signature', v)}
        />
        <TextField
          label="Part structure"
          name="part_structure"
          value={values.part_structure}
          onChange={(v) => set('part_structure', v)}
          maxLength={SONG_LIMITS.part_structure}
          suggestions={PART_STRUCTURES}
        />
      </div>
      <div className="flex gap-6">
        <label className="label cursor-pointer gap-2">
          <input
            type="checkbox"
            className="checkbox"
            checked={values.is_crooked}
            onChange={(e) => set('is_crooked', e.target.checked)}
          />
          Crooked
        </label>
        <label className="label cursor-pointer gap-2">
          <input
            type="checkbox"
            className="checkbox"
            checked={values.has_lyrics}
            onChange={(e) => set('has_lyrics', e.target.checked)}
          />
          Has lyrics
        </label>
      </div>
      <StatusPicker value={values.status} onChange={(status) => set('status', status)} />
      <div className="grid grid-cols-2 gap-2">
        <TextField
          label="Learned from"
          name="learned_from"
          value={values.learned_from}
          onChange={(v) => set('learned_from', v)}
          maxLength={SONG_LIMITS.learned_from}
        />
        <TextField
          label="Learned on"
          name="learned_on"
          type="date"
          value={values.learned_on}
          onChange={(v) => set('learned_on', v)}
        />
      </div>
      <fieldset className="fieldset">
        <legend className="fieldset-legend">Notes</legend>
        <textarea
          className="textarea w-full"
          aria-label="Notes"
          rows={4}
          maxLength={SONG_LIMITS.notes}
          value={values.notes}
          onChange={(e) => set('notes', e.target.value)}
        />
      </fieldset>
      {error ? (
        <p role="alert" className="text-error text-sm">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2 pt-2">
        <button type="submit" className="btn btn-primary min-h-11 flex-1" disabled={pending}>
          {submitLabel}
        </button>
        {onCancel ? (
          <button type="button" className="btn min-h-11" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  )
}
