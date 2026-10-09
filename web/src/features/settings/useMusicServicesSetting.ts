import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import type { PlayFirst, Provider } from '../../api/vocabulary'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import { serviceOf } from '../../usage/service'
import { useAuthSession } from '../../auth/AuthContext'
import { setPlayFirst, settingsId, toggleSearchProvider } from '../../commands/settings'
import { useDb } from '../../db/DbProvider'
import { storedPlayFirst, storedSearchProviders } from '../../db/types'
import { useAction } from '../../ui/useAction'
import { usePendingWrite } from '../../ui/usePendingWrite'
import { SEARCHABLE_PROVIDERS, servicesSummary, useSearchProviders } from './searchProviders'

export interface MusicServicesSetting {
  /** The services a recording search covers; undefined until the settings row has been read. */
  providers: ReadonlySet<Provider> | undefined
  summary: string
  /** Writes one toggle rather than the whole set, so two taps in a row both land. */
  toggle: (provider: Provider, on: boolean) => void
  error: string | null
  clear: () => void
  /** Shows a choice still being written, so a picker never snaps back mid-write. */
  playFirst: PlayFirst
  setPlayFirst: (next: PlayFirst) => void
  playFirstError: string | null
}

/** The streaming services a tune's recording search covers, and which version plays first. */
export function useMusicServicesSetting(): MusicServicesSetting {
  const db = useDb()
  const { userId } = useAuthSession()
  const analytics = useAnalytics()
  const providers = useSearchProviders()
  const { clear, error, run } = useAction()
  const playFirstAction = useAction()
  const settings = useLiveQuery(() => db.user_settings.get(settingsId(userId)), [db, userId])
  // usePendingWrite tells a landed write by identity, so the stored value has to outlive a render.
  const storedFirst = useMemo(() => ({ first: storedPlayFirst(settings) }), [settings])
  const [playFirst, writePlayFirst] = usePendingWrite<{ first: PlayFirst }, { first: PlayFirst }>(
    storedFirst,
    ({ first }) => setPlayFirst(db, userId, first),
  )
  // Read back from the store so toggles made before an earlier one settled are all in the list.
  const reportProviders = () =>
    db.user_settings.get(settingsId(userId)).then(
      (row) =>
        analytics.send('setting_changed', {
          setting: 'search_providers',
          value: storedSearchProviders(row).map(serviceOf),
        }),
      () => {},
    )
  const count = SEARCHABLE_PROVIDERS.filter((provider) => providers?.has(provider)).length
  return {
    providers,
    summary: servicesSummary(count),
    toggle: (provider, on) =>
      run(() => toggleSearchProvider(db, userId, provider, on).then(reportProviders)),
    error,
    clear,
    playFirst: playFirst?.first ?? 'recordings',
    setPlayFirst: (next) => {
      const changed = next !== playFirst?.first
      playFirstAction.run(() =>
        writePlayFirst({ first: next }).then(() => {
          if (changed) analytics.send('setting_changed', { setting: 'play_first', value: next })
        }),
      )
    },
    playFirstError: playFirstAction.error,
  }
}
