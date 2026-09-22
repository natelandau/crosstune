import {
  DEFAULT_INSTRUMENTS,
  TUNING_FIELD_NAMES,
  TUNING_FIELDS,
  type Instrument,
  type TuningField,
} from '../../constants'
import {
  isInstrument,
  storedInstruments,
  type LocalSong,
  type LocalUserSettings,
} from '../../db/types'

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
