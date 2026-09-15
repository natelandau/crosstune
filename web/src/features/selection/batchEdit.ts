import type { BulkPatch } from '../../commands/bulk'
import { MODES, TIME_SIGNATURES, type Instrument } from '../../db/types'
import type { CatalogEntry } from '../catalog/filters'
import { isSongStatus, STATUS_LABELS } from '../catalog/StatusDot'
import { TUNING_FIELDS } from '../settings/instruments'

export const EDIT_FIELDS = [
  'status',
  'key',
  'mode',
  'violin_tuning',
  'banjo_tuning',
  'genre',
  'feel',
  'time_signature',
  'part_structure',
  'is_crooked',
  'has_lyrics',
  'learned_from',
  'learned_on',
] as const

export type EditField = (typeof EDIT_FIELDS)[number]

export const EDIT_FIELD_LABELS: Record<EditField, string> = {
  status: 'Status',
  key: 'Key',
  mode: 'Mode',
  violin_tuning: TUNING_FIELDS.violin_tuning.label,
  banjo_tuning: TUNING_FIELDS.banjo_tuning.label,
  genre: 'Genre',
  feel: 'Feel',
  time_signature: 'Time signature',
  part_structure: 'Part structure',
  is_crooked: 'Crooked',
  has_lyrics: 'Has lyrics',
  learned_from: 'Learned from',
  learned_on: 'Learned on',
}

export const FIELD_KINDS: Record<EditField, 'text' | 'date' | 'select' | 'boolean'> = {
  status: 'select',
  key: 'text',
  mode: 'select',
  violin_tuning: 'text',
  banjo_tuning: 'text',
  genre: 'text',
  feel: 'text',
  time_signature: 'select',
  part_structure: 'text',
  is_crooked: 'boolean',
  has_lyrics: 'boolean',
  learned_from: 'text',
  learned_on: 'date',
}

const USER_SONG_FIELDS: ReadonlySet<EditField> = new Set(['status', 'learned_from', 'learned_on'])

export type Summary =
  { kind: 'shared'; value: string | boolean } | { kind: 'mixed' } | { kind: 'empty' }

/** A string for text, select, and date fields, a boolean for yes or no, and null to clear. */
export type TouchedValue = string | boolean | null
export type Touched = Partial<Record<EditField, TouchedValue>>

// A server row can carry a value from a schema version this client predates;
// fall back to empty rather than trust it as one of this client's known options.
function fieldValue(entry: CatalogEntry, field: EditField): string | boolean | null {
  const row = (USER_SONG_FIELDS.has(field) ? entry.userSong : entry.song) as unknown as Record<
    string,
    unknown
  >
  const value = row[field]
  if (typeof value !== 'string' && typeof value !== 'boolean') return null
  if (field === 'mode') return (MODES as readonly string[]).includes(value as string) ? value : null
  if (field === 'time_signature')
    return (TIME_SIGNATURES as readonly string[]).includes(value as string) ? value : null
  if (field === 'status') return typeof value === 'string' && isSongStatus(value) ? value : null
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

/** Every field, except a tuning for an instrument the user does not play that no selected song fills. */
export function visibleEditFields(
  entries: readonly CatalogEntry[],
  instruments: ReadonlySet<Instrument>,
): EditField[] {
  return EDIT_FIELDS.filter((field) => {
    if (field !== 'violin_tuning' && field !== 'banjo_tuning') return true
    return (
      instruments.has(TUNING_FIELDS[field].instrument) ||
      entries.some((entry) => (entry.song[field] ?? null) !== null)
    )
  })
}

function normalize(value: TouchedValue): string | boolean | null {
  return typeof value === 'string' ? value.trim() || null : value
}

export function touchState(value: TouchedValue): 'change' | 'clear' {
  return normalize(value) === null ? 'clear' : 'change'
}

/**
 * True when saving the value would leave every selected song as it is. Compares the
 * raw value, not the trimmed one used to save and to describe changes, so a trailing
 * space mid-edit does not snap a text field back to untouched.
 */
export function isUnchanged(summary: Summary, value: TouchedValue): boolean {
  if (value === null || value === '') return summary.kind === 'empty'
  return summary.kind === 'shared' && summary.value === value
}

export function toPatch(touched: Touched): BulkPatch {
  const song: Record<string, unknown> = {}
  const userSong: Record<string, unknown> = {}
  for (const field of EDIT_FIELDS) {
    const raw = touched[field]
    if (raw === undefined) continue
    const value = normalize(raw)
    if (field === 'status' && value === null) continue
    const target = USER_SONG_FIELDS.has(field) ? userSong : song
    target[field] = value
  }
  return { song: song as BulkPatch['song'], userSong: userSong as BulkPatch['userSong'] }
}

function display(field: EditField, value: string | boolean): string {
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (field === 'status' && isSongStatus(value)) return STATUS_LABELS[value]
  return value
}

export function describeChanges(touched: Touched): string {
  const parts = EDIT_FIELDS.flatMap((field) => {
    const raw = touched[field]
    if (raw === undefined) return []
    const label = EDIT_FIELD_LABELS[field].toLowerCase()
    const value = normalize(raw)
    return value === null ? [`clear ${label}`] : [`${label} → ${display(field, value)}`]
  })
  if (parts.length === 0) return ''
  return `${parts.length === 1 ? '1 change' : `${parts.length} changes`}: ${parts.join(', ')}`
}
