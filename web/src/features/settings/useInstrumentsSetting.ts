import { INSTRUMENTS, type Instrument } from '../../api/vocabulary'
import { useAnalytics } from '../../analytics/AnalyticsProvider'
import { useAuthSession } from '../../auth/AuthContext'
import { settingsId, toggleInstrumentSetting } from '../../commands/settings'
import { INSTRUMENT_LABELS } from '../../constants'
import { useDb } from '../../db/DbProvider'
import { NOT_SET } from '../../ui/fieldCopy'
import { useAction } from '../../ui/useAction'
import { instrumentsFrom } from '../../domain/instruments'
import { useInstruments } from './useInstruments'

export interface InstrumentsSetting {
  /** Undefined until the settings row has been read. */
  instruments: ReadonlySet<Instrument> | undefined
  /** The chosen instruments in instrument order, or `NOT_SET`. */
  summary: string
  /** Writes one toggle rather than the whole set, so two taps in a row both land. */
  toggle: (instrument: Instrument, on: boolean) => void
  error: string | null
  clear: () => void
}

/** The instruments a musician plays, which decide the tuning fields a tune shows. */
export function useInstrumentsSetting(): InstrumentsSetting {
  const db = useDb()
  const { userId } = useAuthSession()
  const analytics = useAnalytics()
  const instruments = useInstruments()
  const { clear, error, run } = useAction()
  // Read back from the store so toggles made before an earlier one settled are all in the list.
  const reportInstruments = () =>
    db.user_settings.get(settingsId(userId)).then(
      (row) => {
        const stored = instrumentsFrom(row)
        analytics.send('setting_changed', {
          setting: 'instruments',
          value: INSTRUMENTS.filter((instrument) => stored.has(instrument)),
        })
      },
      () => {},
    )
  const chosen = INSTRUMENTS.filter((instrument) => instruments?.has(instrument))
  const summary = chosen.map((instrument) => INSTRUMENT_LABELS[instrument]).join(', ') || NOT_SET
  return {
    instruments,
    summary,
    toggle: (instrument, on) =>
      run(() => toggleInstrumentSetting(db, userId, instrument, on).then(reportInstruments)),
    error,
    clear,
  }
}
