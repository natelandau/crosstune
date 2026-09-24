import { INSTRUMENTS, type Instrument } from '../../api/vocabulary'
import {
  isInstrument,
  storedInstruments,
  type LocalSong,
  type LocalUserSettings,
} from '../../db/types'

/**
 * Each song tuning field, the instrument it belongs to, its label, and the shorter label a row
 * shows when a header above it already says Tuning. `label` stays the accessible name in both
 * places, so a row reading "Violin" is still announced as "Violin tuning".
 */
export const TUNING_FIELDS = {
  violin_tuning: { instrument: 'violin', label: 'Violin tuning', short: 'Violin' },
  banjo_tuning: { instrument: 'five_string_banjo', label: 'Banjo tuning', short: 'Banjo' },
} as const satisfies Record<string, { instrument: Instrument; label: string; short: string }>

export type TuningField = keyof typeof TUNING_FIELDS

export const TUNING_FIELD_NAMES = Object.keys(TUNING_FIELDS) as TuningField[]

/** Instruments the settings list offers: only those a song can show a tuning for, for now. */
export const LISTED_INSTRUMENTS: readonly Instrument[] = INSTRUMENTS.filter((instrument) =>
  Object.values(TUNING_FIELDS).some((field) => field.instrument === instrument),
)

/** The footer under the instruments setting, wherever it is asked. */
export const INSTRUMENTS_HELP = 'Songs show a tuning field for each instrument chosen here.'

export function instrumentsFrom(
  row: LocalUserSettings | null | undefined,
): ReadonlySet<Instrument> {
  const stored = storedInstruments(row)
  return new Set((stored ?? []).filter(isInstrument))
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
