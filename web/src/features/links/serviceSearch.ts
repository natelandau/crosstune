import { RECORDING_ORIGINS, type Provider, type RecordingOrigin } from '../../api/vocabulary'
import type { SearchOutcome, SyncEngine } from '../../sync/types'
import {
  SEARCH_FAILED,
  SEARCH_NEEDS_CONNECTION,
  allowPopups,
  tooManySearches,
} from './findRecordingsCopy'
import { deviceCountry } from './region'

/**
 * The services whose results the app shows itself. Every other one opens its own search page,
 * as does one of these whenever the API answers it `search_only`.
 */
const INLINE_SEARCH: readonly Provider[] = ['apple_music', 'tidal', 'internet_archive']

/** The providers whose audio the server can save as a recording from a link: every origin but the user's own. */
export const IMPORTABLE_PROVIDERS: readonly Provider[] = RECORDING_ORIGINS.filter(
  (origin): origin is Exclude<RecordingOrigin, 'own'> => origin !== 'own',
)

export const searchesInApp = (provider: Provider) => INLINE_SEARCH.includes(provider)

/** The longest query the search route takes, counted in code points as the route counts. */
const MAX_QUERY = 200

/** Trims and caps a query without splitting a surrogate pair, such as an emoji. */
export const searchQuery = (text: string) => Array.from(text.trim()).slice(0, MAX_QUERY).join('')

/** What a search starts from: the tune's name and type. */
export const prefillFor = (tune: { title: string; tune_type?: string | null } | undefined) =>
  tune ? [tune.title, tune.tune_type?.trim()].filter(Boolean).join(' ') : ''

/** Why a search showed nothing, or null when it answered. */
export function outcomeMessage(outcome: SearchOutcome): string | null {
  switch (outcome.kind) {
    case 'offline':
      return SEARCH_NEEDS_CONNECTION
    case 'rate_limited':
      return tooManySearches(outcome.retryAfterSeconds)
    case 'failed':
      return SEARCH_FAILED
    default:
      return null
  }
}

/**
 * Opens a service's own search page for `query` in a new tab. Returns null once it opens, or
 * why it could not. Call it from a tap: the client never builds a service's search URL itself,
 * so the route answers it, and a browser blocks a tab opened after that wait. A blank tab opens
 * now and is sent on once the answer lands.
 */
export async function openServiceSearch(
  engine: SyncEngine,
  query: string,
  provider: Provider,
  label: string,
): Promise<string | null> {
  // Nothing to search for opens nothing.
  if (!query.trim()) return null
  const tab = window.open('', '_blank')
  // A blocked tab stays blocked after the wait, so there is nothing to retry.
  if (!tab) return allowPopups(label)
  tab.opener = null
  const outcome = await engine
    .searchRecordings(query, [provider], deviceCountry())
    .catch((): SearchOutcome => ({ kind: 'failed' }))
  // A tab the musician closed meanwhile is a cancelled search.
  if (tab.closed) return null
  const url =
    outcome.kind === 'ok'
      ? outcome.groups.find((group) => group.provider === provider)?.search_url
      : undefined
  if (!url) {
    tab.close()
    return outcomeMessage(outcome) ?? SEARCH_FAILED
  }
  try {
    // A link followed inside the tab, rather than setting its location from here, sends the
    // service no referrer.
    const link = tab.document.createElement('a')
    link.href = url
    link.rel = 'noreferrer'
    tab.document.body.append(link)
    link.click()
  } catch {
    // Writing into a tab the musician just closed throws; that is a cancel, not a failure.
    return tab.closed ? null : SEARCH_FAILED
  }
  return null
}
