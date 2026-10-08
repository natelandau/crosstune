import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import type { PlayFirst, Provider } from '../../api/vocabulary'
import { useAuthSession } from '../../auth/AuthContext'
import { setPlayFirst, settingsId, toggleSearchProvider } from '../../commands/settings'
import { useDb } from '../../db/DbProvider'
import { storedPlayFirst } from '../../db/types'
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
  const count = SEARCHABLE_PROVIDERS.filter((provider) => providers?.has(provider)).length
  return {
    providers,
    summary: servicesSummary(count),
    toggle: (provider, on) => run(() => toggleSearchProvider(db, userId, provider, on)),
    error,
    clear,
    playFirst: playFirst?.first ?? 'recordings',
    setPlayFirst: (next) => playFirstAction.run(() => writePlayFirst({ first: next })),
    playFirstError: playFirstAction.error,
  }
}
