import { useMemo } from 'react'
import { useAuthSession } from '../../auth/AuthContext'
import { setTunerA4Hz } from '../../commands/settings'
import { useDb } from '../../db/DbProvider'
import { storedTunerA4Hz } from '../../db/types'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import { usePendingWrite } from '../../ui/usePendingWrite'
import { useSettingsRow } from './useSettingsRow'

export interface TunerSettings {
  a4: number
  setA4: (hz: number) => void
}

/** The reference pitch the tuner reads A4 against. */
export function useTunerSettings(): TunerSettings {
  const db = useDb()
  const { userId } = useAuthSession()
  const analytics = useAnalytics()
  const row = useSettingsRow()
  // usePendingWrite tells a landed write by identity, so the stored value has to outlive a render.
  const stored = useMemo(() => ({ a4: storedTunerA4Hz(row) }), [row])
  const [shown, write] = usePendingWrite<{ a4: number }, { a4: number }>(stored, ({ a4: hz }) =>
    setTunerA4Hz(db, userId, hz),
  )
  const a4 = shown?.a4 ?? stored.a4
  return {
    a4,
    setA4: (hz) => {
      if (hz === a4) return
      void write({ a4: hz }).then(
        () => analytics.send('setting_changed', { setting: 'tuner_a4_hz', value: hz }),
        () => {},
      )
    },
  }
}
