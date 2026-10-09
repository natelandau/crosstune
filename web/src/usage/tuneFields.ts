import { INSTRUMENTS } from '../api/vocabulary'
import type { BulkPatch } from '../commands/bulk'
import type { TuneInput, UserTuneInput } from '../commands/tunes'
import type { CatalogEntry } from '../features/catalog/filters'
import { tuningEntry } from '../domain/instruments'
import { emptyValues, inputsFromValues, valuesFromRows } from '../features/tune/tuneFormValues'
import { TUNE_FIELDS, type TuneField } from './events'

type Inputs = { tune: TuneInput; userTune: UserTuneInput }

/** An absent value and a null are the same: nothing set. */
const differs = (a: unknown, b: unknown) => (a ?? null) !== (b ?? null)

const sameList = (a: readonly string[] | undefined, b: readonly string[] | undefined) =>
  (a ?? []).length === (b ?? []).length && (a ?? []).every((value, i) => value === (b ?? [])[i])

/** The fields where `after` differs from `before`, in the plan's order. */
function differing(before: Inputs, after: Inputs): TuneField[] {
  const entries = INSTRUMENTS.map((instrument) => ({
    before: tuningEntry(before.tune.tunings, instrument),
    after: tuningEntry(after.tune.tunings, instrument),
  }))
  const changed = new Set<TuneField>()
  const t = { before: before.tune, after: after.tune }
  const u = { before: before.userTune, after: after.userTune }
  if (differs(t.before.title, t.after.title)) changed.add('title')
  if (!sameList(t.before.alternate_titles, t.after.alternate_titles))
    changed.add('alternate_titles')
  if (differs(u.before.status, u.after.status)) changed.add('status')
  if (differs(t.before.key, t.after.key)) changed.add('key')
  if (!sameList(t.before.modes, t.after.modes)) changed.add('mode')
  if (entries.some((e) => e.before.tuning !== e.after.tuning)) changed.add('tuning')
  if (entries.some((e) => e.before.capo !== e.after.capo)) changed.add('capo')
  if (differs(t.before.genre, t.after.genre)) changed.add('genre')
  if (differs(t.before.tune_type, t.after.tune_type)) changed.add('tune_type')
  if (differs(t.before.time_signature, t.after.time_signature)) changed.add('time_signature')
  if (differs(t.before.part_structure, t.after.part_structure)) changed.add('part_structure')
  if (differs(t.before.composer, t.after.composer)) changed.add('composer')
  if (!!t.before.is_crooked !== !!t.after.is_crooked) changed.add('is_crooked')
  if (differs(t.before.lyrics, t.after.lyrics)) changed.add('lyrics')
  if (differs(u.before.notes, u.after.notes)) changed.add('notes')
  if (differs(u.before.learned_from, u.after.learned_from)) changed.add('learned_from')
  if (differs(u.before.learned_on, u.after.learned_on)) changed.add('learned_on')
  return TUNE_FIELDS.filter((field) => changed.has(field))
}

/**
 * The fields a new tune carries, measured from a blank form so a genre suggested and kept
 * counts as set. A time signature of 4/4 and a status of want to learn are the blank form's own.
 */
export function tuneFieldsSet(input: TuneInput, userInput: UserTuneInput): TuneField[] {
  return differing(inputsFromValues(emptyValues()), { tune: input, userTune: userInput })
}

/**
 * The fields a save changes on `before`, measured from the form's own reading of it so a value
 * this client does not know, which the form shows as unset, is not a change.
 */
export function tuneFieldsChanged(
  before: CatalogEntry,
  input: TuneInput,
  userInput: UserTuneInput,
): TuneField[] {
  const opened = inputsFromValues(valuesFromRows(before.tune, before.userTune), before.tune.tunings)
  return differing(opened, { tune: input, userTune: userInput })
}

const set = (value: unknown) => value !== undefined

/** The fields a bulk patch writes, in the plan's order. */
export function bulkPatchFields(patch: BulkPatch): TuneField[] {
  const { tune = {}, userTune = {}, tunings = {} } = patch
  const written: Record<TuneField, boolean> = {
    title: false,
    alternate_titles: false,
    status: set(userTune.status),
    key: set(tune.key),
    mode: set(tune.modes),
    tuning: Object.values(tunings).some(set),
    capo: false,
    genre: set(tune.genre),
    tune_type: set(tune.tune_type),
    time_signature: set(tune.time_signature),
    part_structure: set(tune.part_structure),
    composer: set(tune.composer),
    is_crooked: set(tune.is_crooked),
    lyrics: set(tune.lyrics),
    notes: false,
    learned_from: set(userTune.learned_from),
    learned_on: set(userTune.learned_on),
  }
  return TUNE_FIELDS.filter((field) => written[field])
}
