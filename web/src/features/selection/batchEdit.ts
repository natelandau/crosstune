import { TIME_SIGNATURES, type Instrument } from '../../api/vocabulary'
import type { BulkPatch } from '../../commands/bulk'
import { STATUS_LABELS } from '../../constants'
import type { CatalogEntry } from '../catalog/filters'
import { isTuneStatus } from '../catalog/status'
import {
  byTuningKey,
  isTuningKey,
  TUNING_KEYS,
  tuningEntry,
  tuningKeyInstrument,
  tuningLabel,
} from '../settings/instruments'
import { DETAIL_LABELS } from '../tune/detailFields'
import { isMode } from '../tune/keyMode'

export const EDIT_FIELDS = [
  'status',
  'key',
  'mode',
  ...TUNING_KEYS,
  'genre',
  'tune_type',
  'time_signature',
  'part_structure',
  'is_crooked',
  'learned_from',
  'learned_on',
] as const

export type EditField = (typeof EDIT_FIELDS)[number]

/** The instrument whose tuning a field edits, or undefined for a column. */
export function tuningInstrument(field: EditField): Instrument | undefined {
  return tuningKeyInstrument(field)
}

export const EDIT_FIELD_LABELS: Record<EditField, string> = {
  status: 'Status',
  key: 'Key',
  mode: DETAIL_LABELS.mode,
  ...byTuningKey(tuningLabel),
  genre: DETAIL_LABELS.genre,
  tune_type: DETAIL_LABELS.tune_type,
  time_signature: DETAIL_LABELS.time_signature,
  part_structure: DETAIL_LABELS.part_structure,
  is_crooked: DETAIL_LABELS.is_crooked,
  learned_from: DETAIL_LABELS.learned_from,
  learned_on: DETAIL_LABELS.learned_on,
}

/** A choice field has a vocabulary and is picked from a list; text and date fields are typed. */
export const FIELD_KINDS: Record<EditField, 'choice' | 'text' | 'date' | 'boolean'> = {
  status: 'choice',
  key: 'choice',
  mode: 'choice',
  ...byTuningKey(() => 'choice' as const),
  genre: 'choice',
  tune_type: 'choice',
  time_signature: 'choice',
  part_structure: 'choice',
  is_crooked: 'boolean',
  learned_from: 'text',
  learned_on: 'date',
}

const USER_TUNE_FIELDS = ['status', 'learned_from', 'learned_on'] as const satisfies EditField[]

type UserTuneField = (typeof USER_TUNE_FIELDS)[number]

function isUserTuneField(field: EditField): field is UserTuneField {
  return USER_TUNE_FIELDS.some((userField) => userField === field)
}

export type Summary =
  { kind: 'shared'; value: string | boolean } | { kind: 'mixed' } | { kind: 'empty' }

/** A string for text, select, and date fields, a boolean for yes or no, and null to clear. */
export type TouchedValue = string | boolean | null
export type Touched = Partial<Record<EditField, TouchedValue>>

// A server row can carry a value from a schema version this client predates;
// fall back to empty rather than trust it as one of this client's known options.
function fieldValue(entry: CatalogEntry, field: EditField): string | boolean | null {
  if (isTuningKey(field)) {
    const instrument = tuningKeyInstrument(field)
    return instrument ? tuningEntry(entry.tune.tunings, instrument).tuning : null
  }
  if (field === 'mode') {
    const modes = entry.tune.modes.filter(isMode)
    return modes.length > 0 ? modes.join(', ') : null
  }
  const value: unknown = isUserTuneField(field) ? entry.userTune[field] : entry.tune[field]
  if (typeof value !== 'string' && typeof value !== 'boolean') return null
  if (field === 'time_signature')
    return TIME_SIGNATURES.some((signature) => signature === value) ? value : null
  if (field === 'status') return typeof value === 'string' && isTuneStatus(value) ? value : null
  return value
}

export function summarize(entries: readonly CatalogEntry[]): Record<EditField, Summary> {
  const summaries = {} as Record<EditField, Summary>
  for (const field of EDIT_FIELDS) {
    const values = entries.map((entry) => fieldValue(entry, field))
    const first = values[0] ?? null
    if (!values.every((value) => value === first)) summaries[field] = { kind: 'mixed' }
    else summaries[field] = first === null ? { kind: 'empty' } : { kind: 'shared', value: first }
  }
  return summaries
}

/** Every field, except a tuning for an instrument the user does not play that no selected tune fills. */
export function visibleEditFields(
  entries: readonly CatalogEntry[],
  instruments: ReadonlySet<Instrument>,
): EditField[] {
  return EDIT_FIELDS.filter((field) => {
    const instrument = tuningInstrument(field)
    if (!instrument) return true
    return (
      instruments.has(instrument) ||
      entries.some((entry) => tuningEntry(entry.tune.tunings, instrument).tuning !== null)
    )
  })
}

function normalize(value: TouchedValue): string | boolean | null {
  return typeof value === 'string' ? value.trim() || null : value
}

/**
 * True when saving the value would leave every selected tune as it is. Compares the
 * raw value, not the trimmed one that is saved, so a trailing space typed mid-edit does
 * not snap a text field back to untouched.
 */
export function isUnchanged(summary: Summary, value: TouchedValue): boolean {
  if (value === null || value === '') return summary.kind === 'empty'
  return summary.kind === 'shared' && summary.value === value
}

export function toPatch(touched: Touched): BulkPatch {
  const tune: Record<string, unknown> = {}
  const userTune: Record<string, unknown> = {}
  const tunings: Partial<Record<Instrument, string | null>> = {}
  for (const field of EDIT_FIELDS) {
    const raw = touched[field]
    if (raw === undefined) continue
    const value = normalize(raw)
    if (field === 'status' && value === null) continue
    if (field === 'mode') {
      tune.modes = typeof value === 'string' ? [value] : []
      continue
    }
    const instrument = tuningInstrument(field)
    if (instrument) tunings[instrument] = typeof value === 'string' ? value : null
    else (isUserTuneField(field) ? userTune : tune)[field] = value
  }
  const patch: BulkPatch = {
    tune: tune as BulkPatch['tune'],
    userTune: userTune as BulkPatch['userTune'],
  }
  if (Object.keys(tunings).length > 0) patch.tunings = tunings
  return patch
}

export function displayValue(field: EditField, value: string | boolean): string {
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (field === 'status' && isTuneStatus(value)) return STATUS_LABELS[value]
  return value
}
