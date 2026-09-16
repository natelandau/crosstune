import { ErrorText, Field, Section } from '../../components/Page'
import { useRef, useState, type FormEvent } from 'react'
import type { SongInput, UserSongInput } from '../../commands/songs'
import { ChipsField, ChoiceChips } from '../../components/ChoiceChips'
import { DateRow, DetailRow, SwitchRow } from '../../components/DetailRow'
import { PickerSheet, TextSheet } from '../../components/PickerSheet'
import { SaveBar } from '../../components/SaveBar'
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
import { isSongStatus } from '../catalog/StatusDot'
import { TUNING_FIELDS, visibleTunings } from '../settings/instruments'
import { DETAIL_FIELDS, type DetailField } from './detailFields'
import { SONG_LIMITS } from './limits'
import { StatusPicker } from './StatusPicker'
import { KEYS, TUNING_SUGGESTIONS } from './suggestions'

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

export function SongForm({ initial, submitLabel, onSubmit, onCancel, instruments }: Props) {
  const [values, setValues] = useState<SongFormValues>(initial ?? emptyValues())
  const [validation, setValidation] = useState<string | null>(null)
  const { error: rejection, pending, run, clear: clearRejection } = useAction()
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

  const titleRef = useRef<HTMLInputElement>(null)
  const [openDetail, setOpenDetail] = useState<DetailField['key'] | null>(null)
  const detailValue = (field: DetailField): string => {
    const raw = values[field.key]
    return typeof raw === 'string' ? raw : ''
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const { song, userSong } = inputsFromValues(values)
    if (!song.title) {
      // A rejection from an earlier attempt no longer describes this form.
      clearRejection()
      setValidation('A title is required')
      titleRef.current?.focus()
      return
    }
    setValidation(null)
    run(() => onSubmit(song, userSong))
  }

  return (
    // Bottom padding clears the fixed save bar, which can hold an error line above its buttons.
    <form onSubmit={handleSubmit} className="space-y-8 pb-28" noValidate>
      <Section>
        <Field>
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Title</legend>
            <label className={`input w-full ${validation ? 'input-error' : ''}`}>
              <input
                ref={titleRef}
                className="grow"
                name="title"
                aria-label="Title"
                aria-invalid={validation ? true : undefined}
                maxLength={SONG_LIMITS.title}
                value={values.title}
                onChange={(e) => {
                  set('title', e.target.value)
                  if (validation) setValidation(null)
                }}
              />
            </label>
          </fieldset>
          {validation ? <ErrorText>{validation}</ErrorText> : null}
        </Field>
        <StatusPicker value={values.status} onChange={(status) => set('status', status)} />
        <ChipsField label="Key">
          <ChoiceChips
            label="Key"
            value={values.key}
            options={KEYS}
            other
            maxLength={SONG_LIMITS.key}
            onChange={(v) => set('key', v)}
          />
        </ChipsField>
        {tunings.map((field) => (
          <ChipsField key={field} label={TUNING_FIELDS[field].label}>
            <ChoiceChips
              label={TUNING_FIELDS[field].label}
              value={values[field]}
              options={TUNING_SUGGESTIONS[field]}
              other
              maxLength={SONG_LIMITS[field]}
              onChange={(v) => set(field, v)}
            />
          </ChipsField>
        ))}
        <fieldset className="fieldset">
          <legend className="fieldset-legend">Notes</legend>
          <textarea
            className="textarea w-full"
            aria-label="Notes"
            rows={3}
            maxLength={SONG_LIMITS.notes}
            value={values.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </fieldset>
      </Section>

      <Section title="Details">
        <div className="row-list">
          {DETAIL_FIELDS.map((field) => {
            if (field.kind === 'switch') {
              return (
                <SwitchRow
                  key={field.key}
                  label={field.label}
                  help={field.help}
                  checked={values[field.key]}
                  onChange={(checked) => set(field.key, checked)}
                />
              )
            }
            if (field.kind === 'date') {
              return (
                <DateRow
                  key={field.key}
                  label={field.label}
                  value={values[field.key]}
                  onChange={(v) => set(field.key, v)}
                />
              )
            }
            return (
              <DetailRow
                key={field.key}
                label={field.label}
                value={detailValue(field)}
                onPress={() => setOpenDetail(field.key)}
              />
            )
          })}
        </div>
      </Section>

      {DETAIL_FIELDS.map((field) => {
        if (field.kind === 'text') {
          return (
            <TextSheet
              key={field.key}
              open={openDetail === field.key}
              title={field.label}
              value={values[field.key]}
              help={field.help}
              maxLength={field.maxLength}
              onChange={(v) => set(field.key, v)}
              onClose={() => setOpenDetail(null)}
            />
          )
        }
        if (field.kind === 'pick') {
          return (
            <PickerSheet
              key={field.key}
              open={openDetail === field.key}
              title={field.label}
              value={values[field.key]}
              options={field.options}
              other={field.other}
              maxLength={field.maxLength}
              onChange={(v) => {
                if (field.key === 'mode') set('mode', asMode(v))
                else if (field.key === 'time_signature') set('time_signature', asTimeSignature(v))
                else set(field.key, v)
              }}
              onClose={() => setOpenDetail(null)}
            />
          )
        }
        return null
      })}

      <SaveBar submitLabel={submitLabel} pending={pending} error={rejection} onCancel={onCancel} />
    </form>
  )
}
