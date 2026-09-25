import {
  INSTRUMENTS,
  MODES,
  TIME_SIGNATURES,
  type Instrument,
  type Mode,
  type TuneStatus,
  type TimeSignature,
} from '../../api/vocabulary'
import type { TuneInput, UserTuneInput } from '../../commands/tunes'
import type { LocalTune, LocalUserTune } from '../../db/types'
import { isTuneStatus } from '../catalog/status'
import { setTuning, tuningEntry, tuningsMap, type TuningsMap } from '../settings/instruments'
import { timeSignatureFor } from './tuneTypes'

/** One instrument's tuning and capo as the form holds them: text, empty when unset. */
export interface TuningValues {
  tuning: string
  capo: string
}

export interface TuneFormValues {
  title: string
  alternate_titles: string
  key: string
  modes: (Mode | '')[]
  composer: string
  tunings: Partial<Record<Instrument, TuningValues>>
  genre: string
  tune_type: string
  part_structure: string
  time_signature: TimeSignature | ''
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
    modes: [],
    composer: '',
    tunings: {},
    genre: '',
    tune_type: '',
    part_structure: '',
    time_signature: '4/4',
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
  MODES.find((mode) => mode === value) ?? ''

export const asTimeSignature = (value: string | null | undefined): TimeSignature | '' =>
  TIME_SIGNATURES.find((signature) => signature === value) ?? ''

export function valuesFromRows(tune: LocalTune, userTune: LocalUserTune): TuneFormValues {
  return {
    title: tune.title,
    alternate_titles: tune.alternate_titles.join(', '),
    key: tune.key ?? '',
    modes: tune.modes.map(asMode).filter((m): m is Mode => m !== ''),
    composer: tune.composer ?? '',
    tunings: Object.fromEntries(
      INSTRUMENTS.map((instrument) => {
        const { tuning, capo } = tuningEntry(tune.tunings, instrument)
        return [instrument, { tuning: tuning ?? '', capo: capo === null ? '' : String(capo) }]
      }),
    ),
    genre: tune.genre ?? '',
    tune_type: tune.tune_type ?? '',
    part_structure: tune.part_structure ?? '',
    time_signature: asTimeSignature(tune.time_signature),
    is_crooked: tune.is_crooked,
    lyrics: tune.lyrics ?? '',
    status: isTuneStatus(userTune.status) ? userTune.status : 'want_to_learn',
    learned_from: userTune.learned_from ?? '',
    learned_on: userTune.learned_on ?? '',
    notes: userTune.notes ?? '',
  }
}

const blankToNull = (value: string): string | null => (value.trim() ? value.trim() : null)

/**
 * The stored map with each instrument the form changed written over it. A key this client does
 * not know, and every field of an entry the form left as stored, survives the save.
 */
function tuningsFromValues(values: TuneFormValues, stored: unknown): TuningsMap {
  let tunings = tuningsMap(stored)
  for (const instrument of INSTRUMENTS) {
    const entry = values.tunings[instrument]
    if (!entry) continue
    const tuning = blankToNull(entry.tuning)
    const capo = entry.capo === '' ? null : Number(entry.capo)
    const current = tuningEntry(stored, instrument)
    if (tuning === current.tuning && capo === current.capo) continue
    tunings = setTuning(tunings, instrument, { tuning, capo })
  }
  return tunings
}

export function inputsFromValues(
  values: TuneFormValues,
  stored?: unknown,
): {
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
      modes: values.modes.filter((m): m is Mode => m !== ''),
      composer: blankToNull(values.composer),
      tunings: tuningsFromValues(values, stored),
      genre: blankToNull(values.genre),
      tune_type: blankToNull(values.tune_type),
      part_structure: blankToNull(values.part_structure),
      time_signature: values.time_signature || null,
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

/** The form's mode rows: one per part, and one empty row for a tune with no mode. */
export const modeRows = (modes: readonly (Mode | '')[]): (Mode | '')[] =>
  modes.length === 0 ? [''] : [...modes]

/** The mode rows with one part's mode set, or emptied for a value this client does not know. */
export function partModeChanged(
  modes: readonly (Mode | '')[],
  index: number,
  value: string,
): (Mode | '')[] {
  return modeRows(modes).map((mode, i) => (i === index ? asMode(value) : mode))
}

/**
 * The values after choosing a type. The type's time signature replaces one the player has
 * not chosen: an empty one, or a new tune's untouched default.
 */
export function typeChanged(
  values: TuneFormValues,
  type: string,
  isNew: boolean,
  timeSignatureTouched: boolean,
): TuneFormValues {
  const next = { ...values, tune_type: type }
  const fill = timeSignatureFor(type)
  const replaceable = values.time_signature === '' || (isNew && !timeSignatureTouched)
  return fill && replaceable ? { ...next, time_signature: fill } : next
}
