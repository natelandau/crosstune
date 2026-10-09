import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { SearchResult } from '../../api/types'
import type { Provider } from '../../api/vocabulary'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import { countBucket } from '../../usage/buckets'
import { serviceOf } from '../../usage/service'
import { addLink } from '../../commands/links'
import { PROVIDER_LABELS } from '../../constants'
import { useDb } from '../../db/DbProvider'
import { useOnline, useSyncEngine } from '../../sync/SyncProvider'
import type { SearchOutcome } from '../../sync/types'
import { useAction } from '../../ui/useAction'
import { useSheetSession } from '../../ui/useSheetSession'
import { usePlayer } from '../player/usePlayer'
import { useSearchProviders } from '../settings/searchProviders'
import { SEARCH_NEEDS_CONNECTION } from './findRecordingsCopy'
import { deviceCountry } from './region'
import { openServiceSearch, prefillFor, searchesInApp, searchQuery } from './serviceSearch'

export type SearchState = { kind: 'idle' } | { kind: 'searching' } | SearchOutcome

/** A result's identity within one search, the key `playing` names. */
export const resultKey = (result: SearchResult) => `${result.provider} ${result.url}`

export interface FindRecordings {
  /** Whether the sheet shows: it has a tune and nothing has asked it to close. */
  open: boolean
  closing: boolean
  /** What the search field holds: the musician's typing, else the tune's name and type. */
  text: string
  /** Sets the typed query. */
  setQuery: (query: string) => void
  /** Whether the chosen services and the tune have read, so the sheet can show them. */
  ready: boolean
  /** The musician's chosen services, undefined until read. */
  providers: ReadonlySet<Provider> | undefined
  /** The service whose results show, or null for the list of services. */
  shown: Provider | null
  /** True when the sheet opened on one service, with no list to go back to. */
  direct: boolean
  search: SearchState
  /** Why the last service opened on its own page could not open. */
  notice: string | null
  /** The key of the result whose player shows, or null. */
  playing: string | null
  /** Shows a result's player, stopping whatever the app's player plays, or hides it with null. */
  setPlaying: (key: string | null) => void
  /** Whether a result's url is already a link on the tune. */
  linked: (url: string) => boolean
  /** Links a result to the tune, at most once. */
  claim: (result: SearchResult) => void
  /** Opens a service: its results in place, or its own search page in a new tab. */
  pick: (provider: Provider) => void
  /** Searches the shown service for the field's text. */
  submit: () => void
  back: () => void
  close: () => void
  /** Closes the sheet, then opens the music services setting once it has gone. */
  openSettings: () => void
  /** The sheet's onClose, run once its dismissal ends. */
  dismissed: () => void
  /** The last link's refusal. */
  error: string | null
}

/**
 * Lists the musician's chosen music services and searches the one they pick: in place for a
 * service the app searches itself, where a result plays inline and links with a tap, or on the
 * service's own search page for any other. Nothing is searched until a service is picked, and
 * nothing found is kept until it is claimed. `tuneId` is null for a closed sheet; the parent
 * nulls it from `onClose`.
 *
 * `service` opens straight on that service's results and searches it, for a musician who chose
 * only that one. It is read when the sheet opens.
 */
export function useFindRecordings(
  tuneId: string | null,
  service: Provider | undefined,
  { onOpenSettings, onClose }: { onOpenSettings: () => void; onClose: () => void },
): FindRecordings {
  const db = useDb()
  const engine = useSyncEngine()
  const analytics = useAnalytics()
  const online = useOnline()
  const providers = useSearchProviders()
  const player = usePlayer()
  const { error, run, clear } = useAction()
  const [query, setQueryState] = useState<string | null>(null)
  const [shown, setShown] = useState<Provider | null>(service ?? null)
  const [direct, setDirect] = useState(service !== undefined)
  const [search, setSearch] = useState<SearchState>({ kind: 'idle' })
  const [notice, setNotice] = useState<string | null>(null)
  const [playing, setPlayingState] = useState<string | null>(null)
  // A sheet opened on one service searches its prefill once, as soon as it has what it needs.
  const [opening, setOpening] = useState(0)
  const searchedOpening = useRef(0)
  // Results linked from this sheet, so a second tap cannot add a link the live query has not
  // reported yet.
  const [claimed, setClaimed] = useState<ReadonlySet<string>>(new Set())
  // The same claims, read by a second tap that lands before the first one's render.
  const claiming = useRef(new Set<string>())
  // Bumped by every search, every Back, and every close, so only the latest answer is shown.
  const request = useRef(0)
  const pagePending = useRef(false)
  const toSettings = useRef(false)

  const sheet = useSheetSession(tuneId, {
    onOpen: () => {
      setQueryState(null)
      setShown(service ?? null)
      setDirect(service !== undefined)
      setSearch(service === undefined ? { kind: 'idle' } : { kind: 'searching' })
      setNotice(null)
      setPlayingState(null)
      setClaimed(new Set())
      claiming.current = new Set()
      setOpening((count) => count + 1)
      clear()
    },
    onClose: () => {
      onClose()
      if (toSettings.current) {
        toSettings.current = false
        onOpenSettings()
      }
    },
  })
  // The tune last opened, kept through the dismissal so the sheet does not empty as it leaves.
  const shownTune = sheet.shown

  const data = useLiveQuery(async () => {
    if (shownTune === null) return null
    const tune = await db.tunes.get(shownTune)
    const links = await db.recording_links.where('tune_id').equals(shownTune).toArray()
    return {
      prefill: prefillFor(tune),
      linked: new Set(links.filter((link) => !link.deleted_at).map((link) => link.url)),
    }
  }, [db, shownTune])

  const text = query ?? data?.prefill ?? ''
  // Null is the live query's answer for the tune before this one, which holds no prefill.
  const ready = providers !== undefined && data != null

  const close = () => {
    request.current += 1
    setPlayingState(null)
    sheet.close()
  }

  /** Starts a search whose answer lands only while it is still the latest one. */
  const startSearch = (q: string, provider: Provider) => {
    const id = ++request.current
    void engine
      .searchRecordings(q, [provider], deviceCountry())
      .catch((): SearchOutcome => ({ kind: 'failed' }))
      .then((outcome) => {
        if (id !== request.current) return
        setSearch(outcome)
        if (outcome.kind === 'ok') {
          const found = outcome.groups.find((group) => group.provider === provider)
          analytics.send('find_recordings_used', {
            service: serviceOf(provider),
            result_count_bucket: countBucket(found?.results.length ?? 0),
          })
        }
      })
  }

  const searchShown = (provider: Provider) => {
    // An Enter before the tune loads is the opening's search, so a late prefill adds none.
    searchedOpening.current = opening
    setPlayingState(null)
    const q = searchQuery(text)
    if (!q) {
      request.current += 1
      setSearch({ kind: 'idle' })
      return
    }
    if (!online) {
      request.current += 1
      setSearch({ kind: 'offline' })
      return
    }
    setSearch({ kind: 'searching' })
    startSearch(q, provider)
  }

  const pick = (provider: Provider) => {
    setNotice(null)
    if (searchesInApp(provider)) {
      setShown(provider)
      searchShown(provider)
      return
    }
    if (!online) {
      setNotice(SEARCH_NEEDS_CONNECTION)
      return
    }
    const q = searchQuery(text)
    if (!q) return
    // A second tap while the first page's address is pending would open a second tab.
    if (pagePending.current) return
    pagePending.current = true
    const id = ++request.current
    void openServiceSearch(engine, q, provider, PROVIDER_LABELS[provider], () =>
      analytics.send('find_recordings_used', { service: serviceOf(provider) }),
    )
      .then((message) => {
        if (id === request.current) setNotice(message)
      })
      .finally(() => {
        pagePending.current = false
      })
  }

  const back = () => {
    request.current += 1
    setPlayingState(null)
    setSearch({ kind: 'idle' })
    setShown(null)
  }

  // Opening on one service shows Searching before this runs, and an empty prefill shows
  // nothing. The engine answers offline itself without touching the network.
  const searchPrefill = useEffectEvent(() => {
    if (!sheet.open || !direct || shown === null || !providers || !data) return
    if (searchedOpening.current === opening) return
    // A tune that arrives after the sheet opens still gets its opening search, unless the
    // user has already typed their own.
    if (query !== null) {
      searchedOpening.current = opening
      return
    }
    const q = searchQuery(text)
    if (!q) return
    searchedOpening.current = opening
    startSearch(q, shown)
  })
  const prefill = data?.prefill
  useEffect(() => searchPrefill(), [opening, sheet.open, ready, prefill, query])

  const setPlaying = (key: string | null) => {
    // One thing plays at a time: the app player's item stops when a result starts.
    if (key !== null && player.item) player.close()
    setPlayingState(key)
  }

  const claim = (result: SearchResult) => {
    const target = shownTune
    if (target === null || claiming.current.has(result.url)) return
    claiming.current.add(result.url)
    setClaimed((current) => new Set(current).add(result.url))
    run(async () => {
      try {
        const linkId = await addLink(db, target, {
          url: result.url,
          provider: result.provider,
          provider_ref: result.provider_ref,
          title: result.title,
          artwork_url: result.artwork_url,
        })
        analytics.send('link_added', {
          service: serviceOf(result.provider),
          via: 'find',
          link_id: linkId,
          tune_id: target,
        })
      } catch (caught) {
        claiming.current.delete(result.url)
        setClaimed((current) => {
          const next = new Set(current)
          next.delete(result.url)
          return next
        })
        throw caught
      }
    })
  }

  return {
    open: sheet.open,
    closing: sheet.closing,
    text,
    setQuery: (value) => {
      setQueryState(value)
      // Typing before the opening search starts leaves nothing in flight.
      if (searchedOpening.current !== opening) {
        setSearch((current) => (current.kind === 'searching' ? { kind: 'idle' } : current))
      }
    },
    ready,
    providers,
    shown,
    direct,
    search,
    notice,
    playing,
    setPlaying,
    linked: (url) => claimed.has(url) || (data?.linked.has(url) ?? false),
    claim,
    pick,
    submit: () => {
      if (shown !== null) searchShown(shown)
    },
    back,
    close,
    openSettings: () => {
      toSettings.current = true
      close()
    },
    dismissed: sheet.dismissed,
    error,
  }
}
