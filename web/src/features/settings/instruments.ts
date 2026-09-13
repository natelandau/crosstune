import {
  DEFAULT_INSTRUMENTS,
  isInstrument,
  storedInstruments,
  type Instrument,
  type LocalSong,
  type LocalUserSettings,
} from '../../db/types'

export const INSTRUMENT_LABELS: Record<Instrument, string> = {
  violin: 'Violin',
  banjo: 'Banjo',
  guitar: 'Guitar',
  mandolin: 'Mandolin',
  ukulele: 'Ukulele',
  bass: 'Bass',
  dulcimer: 'Dulcimer',
  accordion: 'Accordion',
  other: 'Other',
}

/** Each song tuning field, the instrument it belongs to, and its label. */
export const TUNING_FIELDS = {
  violin_tuning: { instrument: 'violin', label: 'Violin tuning' },
  banjo_tuning: { instrument: 'banjo', label: 'Banjo tuning' },
} as const satisfies Record<string, { instrument: Instrument; label: string }>

export type TuningField = keyof typeof TUNING_FIELDS

export const TUNING_FIELD_NAMES = Object.keys(TUNING_FIELDS) as TuningField[]

export function instrumentsFrom(
  row: LocalUserSettings | null | undefined,
): ReadonlySet<Instrument> {
  const stored = storedInstruments(row)
  return stored === null ? new Set(DEFAULT_INSTRUMENTS) : new Set(stored.filter(isInstrument))
}

/** Tuning fields to show: one per played instrument, plus any the song already fills. */
export function visibleTunings(
  instruments: ReadonlySet<Instrument>,
  song: Pick<LocalSong, TuningField> | null,
): TuningField[] {
  return TUNING_FIELD_NAMES.filter(
    (field) => instruments.has(TUNING_FIELDS[field].instrument) || (song?.[field] ?? null) !== null,
  )
}
