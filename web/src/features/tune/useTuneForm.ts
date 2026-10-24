import { useMemo, useRef, useState } from 'react'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import type { Instrument } from '../../api/vocabulary'
import { updateTuneEntry } from '../../commands/tunes'
import { useDb } from '../../db/DbProvider'
import { useAction } from '../../ui/useAction'
import { useCatalog } from '../catalog/useCatalog'
import { instrumentsFrom, tuningInstruments } from '../../domain/instruments'
import { useSettingsRow } from '../settings/useSettingsRow'
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
import { reportEdit } from './useFactWrite'
import { suggestionsFor, type TuneFormSuggestions } from './factSuggestions'

export interface UseTuneFormOptions {
  /** The tune to edit, looked up in the catalog. */
  tuneId: string
  onSaved: (tuneId: string, result: { userTuneId: string }) => void
  /** False stands the catalog read down while a form that outlives its opens is closed. */
  enabled?: boolean
}

/** What a form holds that a field's own value does not: which of them the player has changed. */
export type TuneFormTouched = Partial<Record<keyof TuneFormValues, boolean>>

export interface TuneFormErrors {
  title?: string
  learned_on?: string
}

export type SaveStart = 'started' | 'invalid' | 'ignored'

export interface TuneForm {
  /** False until the instruments and the edited tune have loaded; the form is then seeded. */
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
  const { tuneId, onSaved, enabled = true } = options
  const db = useDb()
  const analytics = useAnalytics()
  const catalog = useCatalog(enabled)
  const settings = useSettingsRow()
  const instruments = useMemo(
    () => (settings === undefined ? undefined : instrumentsFrom(settings)),
    [settings],
  )
  const entry = catalog?.find((e) => e.tune.id === tuneId)
  const missing = entry === undefined && catalog !== undefined
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
    setValues(entry ? valuesFromRows(entry.tune, entry.userTune) : emptyValues())
    setTunings(tuningInstruments(instruments ?? NO_INSTRUMENTS, entry?.tune ?? null))
    setTouched({})
    setErrors({})
    clear()
    setOpens((count) => count + 1)
    setSeeded(true)
  }

  const ready = instruments !== undefined && entry !== undefined
  if (enabled && !seeded && ready) reset()

  const touch = (field: keyof TuneFormValues) =>
    setTouched((current) => ({ ...current, [field]: true }))

  const set: TuneForm['set'] = (field, value) => {
    touch(field)
    if (field === 'title' || field === 'learned_on') {
      setErrors((current) => ({ ...current, [field]: undefined }))
    }
    if (field === 'tune_type') {
      setValues((current) => typeChanged(current, String(value)))
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

  const suggestions = useMemo(
    () => suggestionsFor(values.genre, catalog ?? []),
    [catalog, values.genre],
  )

  const fieldErrors: TuneFormErrors = {
    title: values.title.trim() === '' ? TITLE_REQUIRED : undefined,
    learned_on: learnedOnError(values.learned_on) ?? undefined,
  }
  const valid = !fieldErrors.title && !fieldErrors.learned_on
  const writable = seeded && entry !== undefined

  const validate: TuneForm['validate'] = (field) =>
    setErrors((current) => ({ ...current, [field]: fieldErrors[field] }))

  const save = (): SaveStart => {
    if (!writable || !entry || savingIn.current === opens) return 'ignored'
    const { tune, userTune } = inputsFromValues(values, entry.tune.tunings)
    if (!valid) {
      // A rejection from an earlier attempt no longer describes this form.
      clear()
      setErrors(fieldErrors)
      return 'invalid'
    }
    savingIn.current = opens
    setStartedIn(opens)
    setErrors({})
    runThen(
      async () => {
        try {
          await updateTuneEntry(
            db,
            { tuneId: entry.tune.id, userTuneId: entry.userTune.id },
            tune,
            userTune,
          )
        } catch (caught) {
          savingIn.current = null
          setStartedIn(null)
          throw caught
        }
        reportEdit(analytics, entry, tune, userTune)
      },
      () => onSaved(entry.tune.id, { userTuneId: entry.userTune.id }),
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
