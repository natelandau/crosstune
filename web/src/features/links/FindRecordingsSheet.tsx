import { IonButton, IonItem, IonLabel, useIonRouter } from '@ionic/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowUpRight, ChevronLeft, SlidersHorizontal } from 'lucide-react'
import { Fragment, useEffect, useEffectEvent, useRef, useState } from 'react'
import type { SearchGroup, SearchResult } from '../../api/types'
import type { Provider } from '../../api/vocabulary'
import { addLink } from '../../commands/links'
import { PROVIDER_LABELS } from '../../constants'
import { useDb } from '../../db/DbProvider'
import { useOnline, useSyncEngine } from '../../sync/SyncProvider'
import type { SearchOutcome } from '../../sync/types'
import { EmptyState } from '../../ui/EmptyState'
import { Group } from '../../ui/Group'
import { InlineError } from '../../ui/InlineError'
import { SearchField, type SearchFieldHandle } from '../../ui/SearchField'
import { Sheet } from '../../ui/Sheet'
import { useAction } from '../../ui/useAction'
import { useSheetSession } from '../../ui/useSheetSession'
import { embedFor } from '../player/embed'
import { EmbedFrame } from '../player/EmbedFrame'
import { usePlayer } from '../player/usePlayer'
import { MUSIC_SERVICES, NO_SERVICES, useSearchProviders } from '../settings/searchProviders'
import {
  BACK,
  FIND_RECORDINGS,
  LINK,
  LINKED,
  linkedResult,
  linkResult,
  NO_RESULTS,
  PLAY,
  playResult,
  SEARCH_FOR,
  SEARCH_NEEDS_CONNECTION,
  SEARCHING,
  searchOn,
  searchService,
  unavailableNow,
} from './findRecordingsCopy'
import { deviceCountry } from './region'
import {
  openServiceSearch,
  outcomeMessage,
  prefillFor,
  searchesInApp,
  searchQuery,
} from './serviceSearch'

type SearchState = { kind: 'idle' } | { kind: 'searching' } | SearchOutcome

const resultKey = (result: SearchResult) => `${result.provider} ${result.url}`

/**
 * Lists the musician's chosen music services and searches the one they pick: in place for a
 * service the app searches itself, where a result plays inline and links with a tap, or on the
 * service's own search page for any other. Nothing is searched until a service is picked, and
 * nothing found here is kept until Link is tapped.
 */
export function FindRecordingsSheet({
  tuneId,
  service,
  onClose,
}: {
  /** Null means closed; the parent nulls it from onClose. */
  tuneId: string | null
  /**
   * Opens straight on this service's results and searches it, with no list to go back to, for
   * a musician who chose only this service. Read when the sheet opens.
   */
  service?: Provider
  onClose: () => void
}) {
  const db = useDb()
  const engine = useSyncEngine()
  const router = useIonRouter()
  const online = useOnline()
  const providers = useSearchProviders()
  const player = usePlayer()
  const { error, run, clear } = useAction()
  // The tune last opened, kept through the dismissal so the sheet does not empty as it leaves.
  const [shownTune, setShownTune] = useState<string | null>(tuneId)
  const [query, setQuery] = useState<string | null>(null)
  // The service whose results show, or null for the list of services.
  const [shown, setShown] = useState<Provider | null>(service ?? null)
  const [direct, setDirect] = useState(service !== undefined)
  const [search, setSearch] = useState<SearchState>({ kind: 'idle' })
  // Why the last service opened on its own page could not open.
  const [notice, setNotice] = useState<string | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
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
  const fieldRef = useRef<SearchFieldHandle>(null)

  const sheet = useSheetSession(tuneId, {
    onOpen: (target) => {
      setShownTune(target)
      setQuery(null)
      setShown(service ?? null)
      setDirect(service !== undefined)
      setSearch(service === undefined ? { kind: 'idle' } : { kind: 'searching' })
      setNotice(null)
      setPlaying(null)
      setClaimed(new Set())
      claiming.current = new Set()
      setOpening((count) => count + 1)
      clear()
    },
    onClose: () => {
      onClose()
      if (toSettings.current) {
        toSettings.current = false
        router.push('/settings', 'forward', 'push')
      }
    },
  })

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
    setPlaying(null)
    sheet.close()
  }

  /** Starts a search whose answer lands only while it is still the latest one. */
  const startSearch = (q: string, provider: Provider) => {
    const id = ++request.current
    void engine
      .searchRecordings(q, [provider], deviceCountry())
      .catch((): SearchOutcome => ({ kind: 'failed' }))
      .then((outcome) => {
        if (id === request.current) setSearch(outcome)
      })
  }

  const searchShown = (provider: Provider) => {
    // An Enter before the tune loads is the opening's search, so a late prefill adds none.
    searchedOpening.current = opening
    setPlaying(null)
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
    void openServiceSearch(engine, q, provider, PROVIDER_LABELS[provider])
      .then((message) => {
        if (id === request.current) setNotice(message)
      })
      .finally(() => {
        pagePending.current = false
      })
  }

  const back = () => {
    request.current += 1
    setPlaying(null)
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

  const play = (key: string) => {
    // One thing plays at a time: the dock's item stops when a result starts.
    if (player.item) player.close()
    setPlaying(key)
  }

  const link = (result: SearchResult) => {
    const target = shownTune
    if (target === null || claiming.current.has(result.url)) return
    claiming.current.add(result.url)
    setClaimed((current) => new Set(current).add(result.url))
    run(async () => {
      try {
        await addLink(db, target, {
          url: result.url,
          provider: result.provider,
          provider_ref: result.provider_ref,
          title: result.title,
          artwork_url: result.artwork_url,
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

  const isLinked = (result: SearchResult) =>
    claimed.has(result.url) || (data?.linked.has(result.url) ?? false)

  const resultRows = (result: SearchResult) => {
    const key = resultKey(result)
    const embed = embedFor(result, { autoplay: true })
    const expanded = embed !== null && playing === key
    const linked = isLinked(result)
    return (
      <Fragment key={key}>
        <IonItem lines={expanded ? 'none' : undefined}>
          <IonLabel className="ion-text-wrap">
            <h3 className="type-headline">{result.title}</h3>
            {result.subtitle ? <p className="type-subheadline">{result.subtitle}</p> : null}
          </IonLabel>
          {embed ? (
            <IonButton
              slot="end"
              fill="clear"
              aria-label={playResult(result.title)}
              aria-pressed={expanded}
              onClick={() => (expanded ? setPlaying(null) : play(key))}
            >
              {PLAY}
            </IonButton>
          ) : null}
          <IonButton
            slot="end"
            fill="clear"
            disabled={linked}
            aria-label={linked ? linkedResult(result.title) : linkResult(result.title)}
            onClick={() => link(result)}
          >
            {linked ? LINKED : LINK}
          </IonButton>
        </IonItem>
        {expanded ? (
          <IonItem>
            <div className="w-full pb-3">
              <EmbedFrame embed={embed} title={result.title} />
            </div>
          </IonItem>
        ) : null}
      </Fragment>
    )
  }

  const searchOnRow = (group: SearchGroup) => (
    <IonItem key="search-on">
      <a
        className="flex min-h-11 w-full items-center gap-1 text-(--ion-color-primary)"
        href={group.search_url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {searchOn(PROVIDER_LABELS[group.provider])}
        <ArrowUpRight aria-hidden="true" className="size-4" />
      </a>
    </IonItem>
  )

  /** One service's answer. Its own search page always closes the card, found or not. */
  const groupSection = (group: SearchGroup) => {
    const label = PROVIDER_LABELS[group.provider]
    // A status this client does not know offers the service's own search, as search_only does.
    if (group.status === 'unavailable') {
      return <Group footer={unavailableNow(label)}>{searchOnRow(group)}</Group>
    }
    if (group.status !== 'results') return <Group>{searchOnRow(group)}</Group>
    return (
      <Group footer={group.results.length === 0 ? NO_RESULTS : undefined}>
        {group.results.map(resultRows)}
        {searchOnRow(group)}
      </Group>
    )
  }

  const serviceRows = (chosen: ReadonlySet<Provider>) => (
    <Group error={notice}>
      {[...chosen].map((provider) => {
        const inApp = searchesInApp(provider)
        return (
          <IonItem key={provider} button detail={inApp} onClick={() => pick(provider)}>
            <IonLabel>{searchService(PROVIDER_LABELS[provider])}</IonLabel>
            {inApp ? null : <ArrowUpRight aria-hidden="true" className="size-5" slot="end" />}
          </IonItem>
        )
      })}
    </Group>
  )

  const field = (
    <div className="px-(--form-gutter) pt-(--form-gutter)">
      <SearchField
        ref={fieldRef}
        name={SEARCH_FOR}
        value={text}
        onInput={(value) => {
          setQuery(value)
          // Typing before the opening search starts leaves nothing in flight.
          if (searchedOpening.current !== opening) {
            setSearch((current) => (current.kind === 'searching' ? { kind: 'idle' } : current))
          }
        }}
        onEnter={() => {
          // Closes the on-screen keyboard, which would otherwise cover the results.
          fieldRef.current?.blur()
          if (shown !== null) searchShown(shown)
        }}
      />
    </div>
  )

  const message =
    search.kind === 'idle' || search.kind === 'searching' ? null : outcomeMessage(search)
  const group =
    search.kind === 'ok' ? search.groups.find((answer) => answer.provider === shown) : undefined

  return (
    <Sheet
      open={sheet.open}
      title={shown === null ? FIND_RECORDINGS : PROVIDER_LABELS[shown]}
      dismissible={false}
      onClose={sheet.dismissed}
      height="full"
      start={
        shown !== null && !direct ? (
          <IonButton onClick={back}>
            <ChevronLeft aria-hidden="true" className="size-6" />
            {BACK}
          </IonButton>
        ) : undefined
      }
      end={
        <IonButton strong onClick={close}>
          Done
        </IonButton>
      }
    >
      {!ready ? null : providers.size === 0 ? (
        <EmptyState
          compact
          icon={SlidersHorizontal}
          title={NO_SERVICES}
          action={
            <IonButton
              fill="clear"
              onClick={() => {
                toSettings.current = true
                close()
              }}
            >
              {MUSIC_SERVICES}
            </IonButton>
          }
        />
      ) : shown === null ? (
        <>
          {field}
          {serviceRows(providers)}
        </>
      ) : (
        <>
          {field}
          {/* Always present, so a screen reader hears the search start. */}
          <p role="status" className="type-footnote px-(--form-inset) pt-(--form-text-gap)">
            {/* An opening with nothing to search for starts no search, so it says nothing. */}
            {search.kind === 'searching' && text.trim() ? SEARCHING : null}
          </p>
          {message ? <InlineError className="px-(--form-inset)">{message}</InlineError> : null}
          {error ? <InlineError className="px-(--form-inset)">{error}</InlineError> : null}
          {group ? groupSection(group) : null}
        </>
      )}
    </Sheet>
  )
}
