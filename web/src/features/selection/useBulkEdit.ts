import { useEffect, useMemo, useRef, useState } from 'react'
import { MODES, TIME_SIGNATURES, TUNE_LIMITS, type Instrument } from '../../api/vocabulary'
import type { BulkPatch } from '../../commands/bulk'
import { GENRES, PART_STRUCTURES, QUICK_KEYS, TUNE_TYPES, TUNINGS } from '../../constants'
import type { CatalogEntry } from '../catalog/filters'
import { useCatalog } from '../catalog/useCatalog'
import { byTuningKey } from '../settings/instruments'
import { catalogComposers, catalogLearnedFrom } from '../tune/tuneTypes'
import {
  isUnchanged,
  summarize,
  toPatch,
  tuningInstrument,
  visibleEditFields,
  type EditField,
  type Summary,
  type Touched,
  type TouchedValue,
} from './batchEdit'

/** A field's choices, and whether it takes a value outside them. */
export interface EditPick {
  options: readonly string[]
  other: boolean
}

const PICKS: Partial<Record<EditField, EditPick>> = {
  key: { options: QUICK_KEYS, other: true },
  mode: { options: MODES, other: false },
  ...byTuningKey((instrument) => ({ options: TUNINGS[instrument], other: true })),
  genre: { options: GENRES, other: true },
  tune_type: { options: TUNE_TYPES, other: true },
  time_signature: { options: TIME_SIGNATURES, other: false },
  part_structure: { options: PART_STRUCTURES, other: true },
}

/** The longest value each free-text field takes. */
export const EDIT_LIMITS: Partial<Record<EditField, number>> = {
  ...TUNE_LIMITS,
  ...byTuningKey(() => TUNE_LIMITS.tuning),
}

/** The touched value once the row is touched, the shared value when every tune agrees, else none. */
export function editRowValue(summary: Summary, touched: TouchedValue | undefined): TouchedValue {
  if (touched !== undefined) return touched
  return summary.kind === 'shared' ? summary.value : null
}

export interface BulkEditOptions {
  open: boolean
  /** The selected tunes, in screen order. */
  entries: readonly CatalogEntry[]
  instruments: ReadonlySet<Instrument>
  /** True while the caller's write runs. */
  pending: boolean
  /** Hands the caller the patch; the caller writes it and closes the sheet. */
  onApply: (patch: BulkPatch) => void
  /** The sheet closed without applying anything. */
  onCancel: () => void
}

export interface BulkEdit {
  /** Every field the sheet shows, in order. */
  fields: EditField[]
  /** The tuning fields among `fields`, each with its instrument, for a group per instrument. */
  tunings: { field: EditField; instrument: Instrument }[]
  /** The fields under Details: all but status, key, and the tunings. */
  details: EditField[]
  summaries: Record<EditField, Summary>
  /** The pick lists, with the ones that depend on the catalog filled in. */
  picks: Partial<Record<EditField, EditPick>>
  touched: Touched
  /** Undefined, or the value every tune already holds, leaves the field untouched. */
  touch: (field: EditField, value: TouchedValue | undefined) => void
  touchedCount: number
  /** False until a field is touched, and while a write runs or the sheet is closing. */
  canSave: boolean
  save: () => void
  /** Starts the sheet closing; `dismissed` reports it once the sheet is gone. */
  cancel: () => void
  /** True from Cancel until the sheet is presented again. */
  closing: boolean
  /** The sheet finished dismissing, by any route. */
  dismissed: () => void
}

/**
 * The tune form's own Details list over many tunes at once. Each row reads the value every
 * selected tune shares, Not set when they are all empty, or Mixed when they disagree; only a
 * row the musician touches is written.
 */
export function useBulkEdit({
  open,
  entries,
  instruments,
  pending,
  onApply,
  onCancel,
}: BulkEditOptions): BulkEdit {
  const [touched, setTouched] = useState<Touched>({})
  const [closing, setClosing] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  const [session, setSession] = useState(0)
  // The session the sheet was presented for. Every way out ends here, including Escape, a
  // backdrop tap, a drag to the bottom, and the Android back button, which dismiss with the
  // backdrop role rather than through `closing`.
  const presentedFor = useRef<number | null>(null)
  // Two submits in one tick both read the same committed `pending`, so the guard is a ref.
  const applied = useRef(false)

  // Reset during render, not in an effect, so the sheet's first frame is already clean rather
  // than flashing the previous session's values.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setTouched({})
      setClosing(false)
      setSession((current) => current + 1)
    }
  }

  // Lifted once the caller reports the write settled, so a failed edit can be tried again.
  useEffect(() => {
    if (!pending) applied.current = false
  })

  useEffect(() => {
    if (open) presentedFor.current = session
  }, [open, session])

  const catalog = useCatalog(open)
  const picks = useMemo<Partial<Record<EditField, EditPick>>>(() => {
    const known = catalog ?? []
    return {
      ...PICKS,
      composer: { options: catalogComposers(known), other: true },
      learned_from: { options: catalogLearnedFrom(known), other: true },
    }
  }, [catalog])

  const summaries = useMemo(() => summarize(entries), [entries])
  const fields = useMemo(() => visibleEditFields(entries, instruments), [entries, instruments])

  const touch = (field: EditField, value: TouchedValue | undefined) => {
    setTouched((current) => {
      const next = { ...current }
      if (value === undefined || isUnchanged(summaries[field], value)) delete next[field]
      else next[field] = value
      return next
    })
  }

  const touchedCount = Object.keys(touched).length

  const save = () => {
    if (pending || closing || applied.current || touchedCount === 0) return
    applied.current = true
    onApply(toPatch(touched))
  }

  const dismissed = () => {
    const presented = presentedFor.current
    presentedFor.current = null
    // A second report of one dismissal, one that ends after the caller closed the sheet, or one
    // that ends after a later session opened, belongs to a session that is already gone.
    if (presented === null || presented !== (open ? session : null)) return
    onCancel()
  }

  const tunings = fields.flatMap((field) => {
    const instrument = tuningInstrument(field)
    return instrument ? [{ field, instrument }] : []
  })
  const details = fields.filter(
    (field) => field !== 'status' && field !== 'key' && tuningInstrument(field) === undefined,
  )

  return {
    fields,
    tunings,
    details,
    summaries,
    picks,
    touched,
    touch,
    touchedCount,
    canSave: !pending && !closing && touchedCount > 0,
    save,
    cancel: () => setClosing(true),
    closing,
    dismissed,
  }
}
