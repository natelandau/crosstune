import { useMemo } from 'react'
import type { Provider } from '../../api/vocabulary'
import { SEARCHABLE_PROVIDERS, storedSearchProviders } from '../../db/types'
import { useSettingsRow } from './useSettingsRow'

export { SEARCHABLE_PROVIDERS }

export const MUSIC_SERVICES = 'Music services'

/** The footer under the music services setting, wherever it is asked. */
export const MUSIC_SERVICES_HELP =
  'Select which music services are included when searching for recordings of tunes.'

export const NO_SERVICES = 'No services selected'

/** The settings row's summary: how many of the searchable services are on. */
export function servicesSummary(count: number): string {
  return count === 0 ? NO_SERVICES : `${count} of ${SEARCHABLE_PROVIDERS.length}`
}

/** The services to search, or undefined until the settings row has been read. */
export function useSearchProviders(): ReadonlySet<Provider> | undefined {
  const row = useSettingsRow()
  return useMemo(() => (row === undefined ? undefined : new Set(storedSearchProviders(row))), [row])
}
