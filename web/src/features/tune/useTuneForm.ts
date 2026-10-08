import { useMemo, useRef, useState } from 'react'
import { TUNE_LIMITS, type Instrument } from '../../api/vocabulary'
import { addToList } from '../../commands/lists'
import { updateRecording } from '../../commands/recordings'
import { createTune, updateTuneEntry } from '../../commands/tunes'
import { useDb } from '../../db/DbProvider'
import { messageFor, useAction } from '../../ui/useAction'
import type { CatalogEntry } from '../catalog/filters'
import { useCatalog } from '../catalog/useCatalog'
import { tuningInstruments } from '../../domain/instruments'
import { useInstruments } from '../settings/useInstruments'
import {
  emptyValues,
  inputsFromValues,
  learnedOnError,
  modeRows,
  partModeChanged,
  TITLE_REQUIRED,
  typeChanged,
  valuesFromRows,
  type TuneFormValues,
  type TuningValues,
} from './tuneFormValues'
import { catalogComposers, catalogLearnedFrom, mostUsedGenre, orderedTypes } from './tuneTypes'

export interface UseTuneFormOptions {
  /** The tune to edit, looked up in the catalog. Without it, and without `entry`, the form is new. */
  tuneId?: string
  /** A new tune's starting title. */
  initialTitle?: string
  /** A new tune is added to this list once it exists. */
  listId?: string
  /** A new tune is given this recording once it exists. */
  recordingId?: string
  /** `filingError` says why the list or recording refused a tune that was saved all the same. */
  onSaved: (tuneId: string, result: { userTuneId: string; filingError?: string }) => void
  /** The tune to edit when the caller already holds it, so no catalog lookup waits on it. */
  entry?: CatalogEntry
  /** The instruments played, for a caller that already reads them. */
  instruments?: ReadonlySet<Instrument>
  /** False stands the catalog read down while a form that outlives its opens is closed. */
  enabled?: boolean
}

/** What a form holds that a field's own value does not: which of them the player has changed. */
export type TuneFormTouched = Partial<Record<keyof TuneFormValues, boolean>>

export interface TuneFormSuggestions {
  /** The genre's types first, then the catalog's by use, then the rest. */
  types: string[]
  composers: string[]
  learnedFrom: string[]
}

export interface TuneFormErrors {
  title?: string
  learned_on?: string
}

export type SaveStart = 'started' | 'invalid' | 'ignored'

export interface TuneForm {
  /** False until the instruments, and an edited tune, have loaded; the form is then seeded. */
  ready: boolean
  /** The tune to edit is not in the catalog, because it never was or has since been deleted. */
  missing: boolean
  values: TuneFormValues
  /** Sets a field, applying the rules a field carries: a type fills the time signature. */
  set: <K extends keyof TuneFormValues>(field: K, value: TuneFormValues[K]) => void
  touched: TuneFormTouched
  /** Counts a field as the player's own without a change, for a pick of the value shown. */
  touch: (field: keyof TuneFormValues) => void
  /** Shows the refusal of a field the player has left, before any save asks for it. */
  validate: (field: keyof TuneFormErrors) => void
  setTuning: (instrument: Instrument, patch: Partial<TuningValues>) => void
  setPartMode: (index: number, value: string) => void
  addPartMode: () => void
  /** Decided when the form opens, so a field never disappears mid-edit. */
  visibleFields: { tunings: readonly Instrument[] }
  suggestions: TuneFormSuggestions
  /** Valid and not saving. */
  canSave: boolean
  pending: boolean
  /** Rejections of the fields, set by a save attempt and cleared by editing the field. */
  errors: TuneFormErrors
  /** The last write's rejection. */
  error: string | null
  /** Starts the save: 'invalid' when a field refuses it, 'ignored' while one is running. */
  save: () => SaveStart
  /** Starts the form over from its tune, for a form that opens again without remounting. */
  reset: () => void
}

const NO_INSTRUMENTS: ReadonlySet<Instrument> = new Set()

export function useTuneForm(options: UseTuneFormOptions): TuneForm {
  const { tuneId, initialTitle, listId, recordingId, onSaved, enabled = true } = options
  const db = useDb()
  const catalog = useCatalog(enabled)
  const played = useInstruments(options.instruments === undefined)
  const instruments = options.instruments ?? played
  const entry = options.entry ?? (tuneId ? catalog?.find((e) => e.tune.id === tuneId) : undefined)
  const isNew = options.entry === undefined && tuneId === undefined
  const missing = !isNew && entry === undefined && catalog !== undefined
  const { error, pending, runThen, clear } = useAction()

  const [values, setValues] = useState<TuneFormValues>(emptyValues)
  const [tunings, setTunings] = useState<Instrument[]>([])
  const [touched, setTouched] = useState<TuneFormTouched>({})
  const [errors, setErrors] = useState<TuneFormErrors>({})
  const [seeded, setSeeded] = useState(false)
  // Counts opens of the form, so a save started in an earlier one never blocks this one.
  const [opens, setOpens] = useState(0)
  // The open a save started in, as a ref because two submits in one tick read the same render.
  const savingIn = useRef<number | null>(null)
  // The same fact as a value, because a render may not read the ref.
  const [startedIn, setStartedIn] = useState<number | null>(null)

  const reset = () => {
    // A seeded title arrives from a search box with no limit of its own, and a field's
    // maxlength only holds back typing, so the cap is applied to the value itself.
    setValues(
      entry
        ? valuesFromRows(entry.tune, entry.userTune)
        : { ...emptyValues(), title: (initialTitle ?? '').slice(0, TUNE_LIMITS.title) },
    )
    setTunings(tuningInstruments(instruments ?? NO_INSTRUMENTS, entry?.tune ?? null))
    setTouched({})
    setErrors({})
    clear()
    setOpens((count) => count + 1)
    setSeeded(true)
  }

  const ready = instruments !== undefined && (isNew || entry !== undefined)
  if (enabled && !seeded && ready) reset()

  // The catalog arrives after the form has opened, so a new tune's genre is seeded on the
  // first render that has it. Seeding fills the genre, so this runs once per open.
  const seedGenre =
    enabled && seeded && isNew && !touched.genre && values.genre === ''
      ? mostUsedGenre(catalog ?? [])
      : null
  if (seedGenre) setValues((current) => ({ ...current, genre: seedGenre }))

  const touch = (field: keyof TuneFormValues) =>
    setTouched((current) => ({ ...current, [field]: true }))

  const set: TuneForm['set'] = (field, value) => {
    touch(field)
    if (field === 'title' || field === 'learned_on') {
      setErrors((current) => ({ ...current, [field]: undefined }))
    }
    if (field === 'tune_type') {
      setValues((current) => typeChanged(current, String(value), isNew, !!touched.time_signature))
    } else {
      setValues((current) => ({ ...current, [field]: value }))
    }
  }

  const setTuning: TuneForm['setTuning'] = (instrument, patch) => {
    touch('tunings')
    setValues((current) => ({
      ...current,
      tunings: {
        ...current.tunings,
        [instrument]: { tuning: '', capo: '', ...current.tunings[instrument], ...patch },
      },
    }))
  }

  const setPartMode: TuneForm['setPartMode'] = (index, value) => {
    touch('modes')
    setValues((current) => ({ ...current, modes: partModeChanged(current.modes, index, value) }))
  }

  const addPartMode = () => {
    touch('modes')
    setValues((current) => ({ ...current, modes: [...modeRows(current.modes), ''] }))
  }

  const suggestions = useMemo<TuneFormSuggestions>(() => {
    const entries = catalog ?? []
    return {
      types: orderedTypes(values.genre, entries),
      composers: catalogComposers(entries),
      learnedFrom: catalogLearnedFrom(entries),
    }
  }, [catalog, values.genre])

  const fieldErrors: TuneFormErrors = {
    title: values.title.trim() === '' ? TITLE_REQUIRED : undefined,
    learned_on: learnedOnError(values.learned_on) ?? undefined,
  }
  const valid = !fieldErrors.title && !fieldErrors.learned_on
  // An edit with no tune to write to never falls back to creating one.
  const writable = seeded && (isNew || entry !== undefined)

  const validate: TuneForm['validate'] = (field) =>
    setErrors((current) => ({ ...current, [field]: fieldErrors[field] }))

  const save = (): SaveStart => {
    if (!writable || savingIn.current === opens) return 'ignored'
    const { tune, userTune } = inputsFromValues(values, entry?.tune.tunings)
    if (!valid) {
      // A rejection from an earlier attempt no longer describes this form.
      clear()
      setErrors(fieldErrors)
      return 'invalid'
    }
    savingIn.current = opens
    setStartedIn(opens)
    setErrors({})
    const saved: { tuneId: string; userTuneId: string; filingError?: string } = {
      tuneId: '',
      userTuneId: '',
    }
    runThen(
      async () => {
        try {
          if (entry) {
            saved.tuneId = entry.tune.id
            saved.userTuneId = entry.userTune.id
            await updateTuneEntry(
              db,
              { tuneId: saved.tuneId, userTuneId: saved.userTuneId },
              tune,
              userTune,
            )
            return
          }
          const created = await createTune(db, tune, userTune)
          Object.assign(saved, created)
        } catch (caught) {
          savingIn.current = null
          setStartedIn(null)
          throw caught
        }
        // The tune exists now, so a refused filing must not fail the save: a retry would
        // create it twice. Each filing is tried on its own, and the first refusal is reported.
        const filings = [
          listId ? () => addToList(db, listId, saved.userTuneId) : null,
          recordingId ? () => updateRecording(db, recordingId, { tune_id: saved.tuneId }) : null,
        ]
        for (const file of filings) {
          await file?.().catch((caught: unknown) => {
            saved.filingError ??= messageFor(caught)
          })
        }
      },
      () => onSaved(saved.tuneId, { userTuneId: saved.userTuneId, filingError: saved.filingError }),
    )
    return 'started'
  }

  return {
    ready,
    missing,
    values,
    set,
    touched,
    touch,
    validate,
    setTuning,
    setPartMode,
    addPartMode,
    visibleFields: { tunings },
    suggestions,
    canSave: valid && !pending && writable && startedIn !== opens,
    pending,
    errors,
    error,
    save,
    reset,
  }
}
