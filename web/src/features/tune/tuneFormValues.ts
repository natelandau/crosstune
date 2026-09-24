import {
  MODES,
  TIME_SIGNATURES,
  type Mode,
  type TuneStatus,
  type TimeSignature,
} from '../../api/vocabulary'
import type { TuneInput, UserTuneInput } from '../../commands/tunes'
import type { LocalTune, LocalUserTune } from '../../db/types'
import { isTuneStatus } from '../catalog/status'

export interface TuneFormValues {
  title: string
  alternate_titles: string
  key: string
  mode: Mode | ''
  /** The row's raw stored mode, kept only until the player picks or clears one, so a value
   *  this client predates survives a save that never touches the field. */
  mode_raw: string | null
  violin_tuning: string
  banjo_tuning: string
  genre: string
  feel: string
  part_structure: string
  time_signature: TimeSignature | ''
  /** The row's raw stored time signature, kept only until the player picks or clears one, so a
   *  value this client predates survives a save that never touches the field. */
  time_signature_raw: string | null
  is_crooked: boolean
  lyrics: string
  status: TuneStatus
  learned_from: string
  learned_on: string
  notes: string
}

export function emptyValues(): TuneFormValues {
  return {
    title: '',
    alternate_titles: '',
    key: '',
    mode: '',
    mode_raw: null,
    violin_tuning: '',
    banjo_tuning: '',
    genre: '',
    feel: '',
    part_structure: '',
    time_signature: '4/4',
    time_signature_raw: null,
    is_crooked: false,
    lyrics: '',
    status: 'want_to_learn',
    learned_from: '',
    learned_on: '',
    notes: '',
  }
}

// A server row can carry a facet value from a schema version this client predates;
// fall back rather than trust it as one of this client's known options.
export const asMode = (value: string | null | undefined): Mode | '' =>
  (MODES as readonly string[]).includes(value ?? '') ? (value as Mode) : ''

export const asTimeSignature = (value: string | null | undefined): TimeSignature | '' =>
  (TIME_SIGNATURES as readonly string[]).includes(value ?? '') ? (value as TimeSignature) : ''

export function valuesFromRows(tune: LocalTune, userTune: LocalUserTune): TuneFormValues {
  return {
    title: tune.title,
    alternate_titles: tune.alternate_titles.join(', '),
    key: tune.key ?? '',
    mode: asMode(tune.mode),
    mode_raw: tune.mode ?? null,
    violin_tuning: tune.violin_tuning ?? '',
    banjo_tuning: tune.banjo_tuning ?? '',
    genre: tune.genre ?? '',
    feel: tune.feel ?? '',
    part_structure: tune.part_structure ?? '',
    time_signature: asTimeSignature(tune.time_signature),
    time_signature_raw: tune.time_signature ?? null,
    is_crooked: tune.is_crooked,
    lyrics: tune.lyrics ?? '',
    status: isTuneStatus(userTune.status) ? userTune.status : 'want_to_learn',
    learned_from: userTune.learned_from ?? '',
    learned_on: userTune.learned_on ?? '',
    notes: userTune.notes ?? '',
  }
}

const blankToNull = (value: string): string | null => (value.trim() ? value.trim() : null)

export function inputsFromValues(values: TuneFormValues): {
  tune: TuneInput
  userTune: UserTuneInput
} {
  return {
    tune: {
      title: values.title.trim(),
      alternate_titles: values.alternate_titles
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      key: blankToNull(values.key),
      // A raw fallback may hold a value from a schema version this client predates; write it
      // through untyped, the same as a pulled row carries it locally.
      mode: (values.mode || values.mode_raw) as Mode | null,
      violin_tuning: blankToNull(values.violin_tuning),
      banjo_tuning: blankToNull(values.banjo_tuning),
      genre: blankToNull(values.genre),
      feel: blankToNull(values.feel),
      part_structure: blankToNull(values.part_structure),
      time_signature: (values.time_signature || values.time_signature_raw) as TimeSignature | null,
      is_crooked: values.is_crooked,
      lyrics: blankToNull(values.lyrics),
    },
    userTune: {
      status: values.status,
      learned_from: blankToNull(values.learned_from),
      learned_on: values.learned_on || null,
      notes: blankToNull(values.notes),
    },
  }
}
