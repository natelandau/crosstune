import { IonContent, IonPage } from '@ionic/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { SearchGroup, SearchResult } from '../../api/types'
import type { Provider } from '../../api/vocabulary'
import { addLink } from '../../commands/links'
import { toggleSearchProvider } from '../../commands/settings'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import type { SearchOutcome, SyncEngine } from '../../sync/types'
import { openTestDb } from '../../test/db'
import { renderScreen } from '../../test/ionic'
import { fakeEngine, fakePlayer } from '../../test/providers'
import type { Player } from '../player/usePlayer'
import { embedFor } from '../player/embed'
import { MUSIC_SERVICES, NO_SERVICES, SEARCHABLE_PROVIDERS } from '../settings/searchProviders'
import { FindRecordingsSheet } from './FindRecordingsSheet'
import {
  BACK,
  FIND_RECORDINGS,
  unavailableNow,
  linkResult,
  linkedResult,
  NO_RESULTS,
  playResult,
  SEARCH_FAILED,
  SEARCH_FOR,
  SEARCH_NEEDS_CONNECTION,
  SEARCHING,
  searchOn,
  searchService,
  tooManySearches,
} from './findRecordingsCopy'
import { deviceCountry } from './region'

let db: CrosstuneDb
let tuneId: string

beforeEach(async () => {
  db = openTestDb()
  ;({ tuneId } = await createTune(
    db,
    { title: 'The Silver Spear', tune_type: 'Reel' },
    { status: 'learning' },
  ))
})

afterEach(() => {
  vi.restoreAllMocks()
})

const silver: SearchResult = {
  url: 'https://music.apple.com/us/album/harvest-storm/1?i=2',
  provider: 'apple_music',
  provider_ref: '2',
  title: 'The Silver Spear',
  subtitle: 'Altan · Harvest Storm',
  artwork_url: 'https://is1-ssl.mzstatic.com/image/a.jpg',
}

const harvest: SearchResult = {
  url: 'https://music.apple.com/us/album/harvest-storm/1?i=3',
  provider: 'apple_music',
  provider_ref: '3',
  title: 'Silver Spear, live',
  subtitle: 'Altan · Live',
  artwork_url: null,
}

const appleSearch = 'https://music.apple.com/search?term=silver'
const tidalSearch = 'https://tidal.com/search?q=silver'
const spotifySearch = 'https://open.spotify.com/search/silver'

const apple: SearchGroup = {
  provider: 'apple_music',
  status: 'results',
  results: [silver, harvest],
  search_url: appleSearch,
}

const answering = (outcome: SearchOutcome) =>
  vi.fn<SyncEngine['searchRecordings']>(async () => outcome)

const appleAnswer = () => answering({ kind: 'ok', groups: [apple] })

/** Answers each search with whatever was asked, held until the test lets it through. */
function held() {
  const pending: ((outcome: SearchOutcome) => void)[] = []
  const searchRecordings = vi.fn<SyncEngine['searchRecordings']>(
    () => new Promise((resolve) => pending.push(resolve)),
  )
  return { pending, searchRecordings }
}

vi.mock('../../commands/links', { spy: true })

const sheetOpen = () => document.querySelector('ion-modal:not(.overlay-hidden)') !== null
const frames = () => Array.from(document.querySelectorAll<HTMLIFrameElement>('ion-modal iframe'))
const query = () => page.getByRole('searchbox', { name: SEARCH_FOR })
const row = (label: string) => page.getByRole('button', { name: searchService(label) })
const playing = () => frames().map((frame) => frame.src)
const statusText = () =>
  page
    .getByRole('status')
    .elements()
    .map((element) => element.textContent)

/** A stand-in for the blank tab a search-only service opens in. */
function fakeTab() {
  const tab = {
    opener: {} as unknown,
    document: document.implementation.createHTMLDocument(),
    close: vi.fn(),
  }
  const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
  return { tab, open }
}

function Host({ onClose = () => {}, service }: { onClose?: () => void; service?: Provider }) {
  const [current, setCurrent] = useState<string | null>(tuneId)
  return (
    <IonPage>
      <IonContent>
        <button type="button" onClick={() => setCurrent(tuneId)}>
          Reopen
        </button>
        <FindRecordingsSheet
          tuneId={current}
          service={service}
          onClose={() => {
            onClose()
            setCurrent(null)
          }}
        />
      </IonContent>
    </IonPage>
  )
}

function show(
  engine: SyncEngine,
  {
    onClose,
    player,
    service,
    strict = false,
  }: { onClose?: () => void; player?: Player; service?: Provider; strict?: boolean } = {},
) {
  renderScreen(<Host onClose={onClose} service={service} />, {
    db,
    engine,
    player,
    strict,
    path: `/catalog/${tuneId}`,
    route: '/catalog/:tuneId',
    probes: { '/settings': 'Settings page' },
  })
}

async function submit(text?: string) {
  await expect.element(query()).toBeVisible()
  if (text !== undefined) await query().fill(text)
  await query().click()
  await userEvent.keyboard('{Enter}')
}

/** Opens the sheet and picks Apple Music, then waits for its results. */
async function searched(engine: SyncEngine, player?: Player) {
  show(engine, { player })
  await row('Apple Music').click()
  await expect.element(page.getByRole('button', { name: playResult(silver.title) })).toBeVisible()
}

/**
 * Plays the first result and waits for it. React runs every pending effect before it renders
 * the tap, so any search an effect starts has been made once the player shows.
 */
async function playRendered() {
  await page.getByRole('button', { name: playResult(silver.title) }).click()
  await expect.poll(playing).toEqual([embedFor(silver, { autoplay: true })!.src])
}

async function onlyChoose(chosen: Provider[]) {
  for (const provider of SEARCHABLE_PROVIDERS) {
    if (!chosen.includes(provider)) await toggleSearchProvider(db, 'user_1', provider, false)
  }
}

describe('FindRecordingsSheet', () => {
  describe('the list of services', () => {
    it('lists a row per chosen service in order and searches nothing on opening', async () => {
      await toggleSearchProvider(db, 'user_1', 'youtube', false)
      const searchRecordings = appleAnswer()
      // StrictMode runs effects twice, as the app's dev build does.
      show(fakeEngine({ searchRecordings }), { strict: true })
      await expect.element(page.getByRole('dialog', { name: FIND_RECORDINGS })).toBeInTheDocument()
      await expect.element(query()).toHaveValue('The Silver Spear Reel')
      await expect.element(row('SoundCloud')).toBeVisible()
      const rows = () =>
        Array.from(document.querySelectorAll('ion-modal ion-item ion-label')).map(
          (label) => label.textContent,
        )
      await expect
        .poll(rows)
        .toEqual(
          [
            'Apple Music',
            'TIDAL',
            'Internet Archive',
            'Slippery-Hill',
            'Spotify',
            'Bandcamp',
            'SoundCloud',
          ].map(searchService),
        )
      expect(page.getByRole('button', { name: BACK }).elements()).toHaveLength(0)
      // Picking a service searches it, so its search is the only one made.
      await row('Apple Music').click()
      await expect
        .poll(() => searchRecordings.mock.calls)
        .toEqual([['The Silver Spear Reel', ['apple_music'], deviceCountry()]])
    })

    it('prefills just the name of a tune with no type', async () => {
      await db.tunes.update(tuneId, { tune_type: null })
      show(fakeEngine())
      await expect.element(query()).toHaveValue('The Silver Spear')
    })

    it('searches nothing on Enter', async () => {
      const searchRecordings = appleAnswer()
      show(fakeEngine({ searchRecordings }))
      await submit('Silver Spear Altan')
      // Picking a service searches it, so its search is the only one made.
      await row('Apple Music').click()
      await expect
        .poll(() => searchRecordings.mock.calls)
        .toEqual([['Silver Spear Altan', ['apple_music'], deviceCountry()]])
    })

    it('offers the setting instead of searching when no service is chosen', async () => {
      await onlyChoose([])
      const searchRecordings = appleAnswer()
      show(fakeEngine({ searchRecordings }))
      await expect.element(page.getByText(NO_SERVICES)).toBeVisible()
      expect(query().elements()).toHaveLength(0)
      await page.getByRole('button', { name: MUSIC_SERVICES, exact: true }).click()
      await expect.element(page.getByRole('heading', { name: 'Settings page' })).toBeVisible()
      await vi.waitFor(() => expect(sheetOpen()).toBe(false))
      expect(searchRecordings).not.toHaveBeenCalled()
    })
  })

  describe("a service the app doesn't search", () => {
    const spotify: SearchGroup = {
      provider: 'spotify',
      status: 'search_only',
      results: [],
      search_url: spotifySearch,
    }

    it('opens its own search page for the current text and stays on the list', async () => {
      const { tab, open } = fakeTab()
      const searchRecordings = answering({ kind: 'ok', groups: [spotify] })
      show(fakeEngine({ searchRecordings }))
      await query().fill('Silver Spear Altan')
      await row('Spotify').click()
      await vi.waitFor(() => expect(tab.document.querySelector('a')?.href).toBe(spotifySearch))
      await expect.poll(() => open.mock.calls.length).toBe(1)
      expect(searchRecordings).toHaveBeenCalledWith(
        'Silver Spear Altan',
        ['spotify'],
        deviceCountry(),
      )
      await expect.element(page.getByRole('dialog', { name: FIND_RECORDINGS })).toBeInTheDocument()
      await expect.element(row('Spotify')).toBeVisible()
    })

    it("says so when its page couldn't be found", async () => {
      const { tab } = fakeTab()
      show(fakeEngine({ searchRecordings: answering({ kind: 'failed' }) }))
      await row('Spotify').click()
      await expect.element(page.getByText(SEARCH_FAILED)).toBeVisible()
      await expect.poll(() => tab.close.mock.calls.length).toBe(1)
    })

    it('opens one tab for a double tap while the page address is pending', async () => {
      const { tab, open } = fakeTab()
      let release: (outcome: SearchOutcome) => void = () => {}
      const searchRecordings = vi.fn<SyncEngine['searchRecordings']>(
        () => new Promise<SearchOutcome>((resolve) => (release = resolve)),
      )
      show(fakeEngine({ searchRecordings }))
      await query().fill('Silver Spear')
      await row('Spotify').click()
      await row('Spotify').click()
      await expect.poll(() => open.mock.calls.length).toBe(1)
      release({ kind: 'ok', groups: [spotify] })
      // The tab is sent on just before the page stops pending.
      await vi.waitFor(() => expect(tab.document.querySelector('a')?.href).toBe(spotifySearch))
      await row('Spotify').click()
      await expect.poll(() => open.mock.calls.length).toBe(2)
    })

    it('refuses offline without opening a tab', async () => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      const open = vi.spyOn(window, 'open')
      const searchRecordings = answering({ kind: 'ok', groups: [spotify] })
      show(fakeEngine({ searchRecordings }))
      await row('Spotify').click()
      await expect.element(page.getByText(SEARCH_NEEDS_CONNECTION)).toBeVisible()
      expect(open).not.toHaveBeenCalled()
      expect(searchRecordings).not.toHaveBeenCalled()
    })
  })

  describe("a service's results", () => {
    it('searches only that service with the current text', async () => {
      const searchRecordings = appleAnswer()
      show(fakeEngine({ searchRecordings }))
      await query().fill('Silver Spear Altan')
      await row('Apple Music').click()
      await expect.element(page.getByRole('dialog', { name: 'Apple Music' })).toBeInTheDocument()
      await expect
        .element(page.getByRole('button', { name: playResult(silver.title) }))
        .toBeVisible()
      await expect.poll(() => searchRecordings.mock.calls.length).toBe(1)
      expect(searchRecordings).toHaveBeenCalledWith(
        'Silver Spear Altan',
        ['apple_music'],
        deviceCountry(),
      )
    })

    it('shows each result with Play and Link, then the service’s own search last', async () => {
      await searched(fakeEngine({ searchRecordings: appleAnswer() }))
      for (const result of [silver, harvest]) {
        await expect
          .element(page.getByRole('button', { name: playResult(result.title) }))
          .toBeVisible()
        await expect
          .element(page.getByRole('button', { name: linkResult(result.title) }))
          .toBeVisible()
      }
      await expect.element(page.getByText(silver.subtitle!)).toBeVisible()
      const searchOnApple = page.getByRole('link', { name: searchOn('Apple Music') })
      await expect.element(searchOnApple).toHaveAttribute('href', appleSearch)
      await expect.element(searchOnApple).toHaveAttribute('target', '_blank')
      await expect.element(searchOnApple).toHaveAttribute('rel', 'noopener noreferrer')
      await expect
        .poll(
          () =>
            Array.from(document.querySelectorAll('ion-modal ion-list ion-item'))
              .at(-1)
              ?.querySelector('a')?.href,
        )
        .toBe(appleSearch)
      // Artwork is stored with a link, never shown.
      expect(document.querySelector('ion-modal img')).toBeNull()
    })

    it('searches the service again on Enter with the edited text and closes the keyboard', async () => {
      const searchRecordings = appleAnswer()
      await searched(fakeEngine({ searchRecordings }))
      await submit('Silver Spear Altan')
      await vi.waitFor(() => expect(searchRecordings).toHaveBeenCalledTimes(2))
      expect(searchRecordings.mock.calls[1]).toEqual([
        'Silver Spear Altan',
        ['apple_music'],
        deviceCountry(),
      ])
      const input = document.querySelector('ion-modal ion-searchbar input')
      await vi.waitFor(() => expect(document.activeElement).not.toBe(input))
    })

    it('caps a long query at 200 code points without splitting an emoji', async () => {
      const searchRecordings = appleAnswer()
      show(fakeEngine({ searchRecordings }))
      await query().fill(`${'a'.repeat(199)}🎻🎻`)
      await row('Apple Music').click()
      await vi.waitFor(() => expect(searchRecordings).toHaveBeenCalledOnce())
      expect(searchRecordings.mock.calls[0]![0]).toBe(`${'a'.repeat(199)}🎻`)
    })

    it('goes Back to the list with the text kept', async () => {
      await searched(fakeEngine({ searchRecordings: appleAnswer() }))
      await query().fill('Silver Spear Altan')
      await page.getByRole('button', { name: BACK }).click()
      await expect.element(page.getByRole('dialog', { name: FIND_RECORDINGS })).toBeInTheDocument()
      await expect.element(row('TIDAL')).toBeVisible()
      await expect.element(query()).toHaveValue('Silver Spear Altan')
    })

    it('ignores an answer that lands after Back', async () => {
      const { pending, searchRecordings } = held()
      show(fakeEngine({ searchRecordings }))
      await row('Apple Music').click()
      await vi.waitFor(() => expect(pending).toHaveLength(1))
      await page.getByRole('button', { name: BACK }).click()
      pending[0]!({ kind: 'ok', groups: [apple] })
      await row('Apple Music').click()
      await vi.waitFor(() => expect(pending).toHaveLength(2))
      // The second search is still out, so any results showing came from the first.
      await expect.element(page.getByRole('status')).toHaveTextContent(SEARCHING)
      expect(page.getByRole('button', { name: playResult(silver.title) }).elements()).toHaveLength(
        0,
      )
    })

    it('says when the service found nothing, and offers its own search', async () => {
      const empty: SearchGroup = { ...apple, results: [] }
      show(fakeEngine({ searchRecordings: answering({ kind: 'ok', groups: [empty] }) }))
      await row('Apple Music').click()
      await expect.element(page.getByText(NO_RESULTS)).toBeVisible()
      await expect
        .element(page.getByRole('link', { name: searchOn('Apple Music') }))
        .toHaveAttribute('href', appleSearch)
    })

    it("names a service it couldn't reach, with its own search as the way on", async () => {
      const tidal: SearchGroup = {
        provider: 'tidal',
        status: 'unavailable',
        results: [],
        search_url: tidalSearch,
      }
      show(fakeEngine({ searchRecordings: answering({ kind: 'ok', groups: [tidal] }) }))
      await row('TIDAL').click()
      await expect.element(page.getByText(unavailableNow('TIDAL'))).toBeVisible()
      await expect
        .element(page.getByRole('link', { name: searchOn('TIDAL') }))
        .toHaveAttribute('href', tidalSearch)
    })

    it('offers only its own search when the API has no search of it in the app', async () => {
      const searchOnly: SearchGroup = { ...apple, status: 'search_only', results: [] }
      show(fakeEngine({ searchRecordings: answering({ kind: 'ok', groups: [searchOnly] }) }))
      await row('Apple Music').click()
      await expect
        .element(page.getByRole('link', { name: searchOn('Apple Music') }))
        .toHaveAttribute('href', appleSearch)
      expect(page.getByText(NO_RESULTS).elements()).toHaveLength(0)
    })

    it('offers only its own search for a status this client does not know', async () => {
      const unknown = { ...apple, status: 'maintenance' } as unknown as SearchGroup
      show(fakeEngine({ searchRecordings: answering({ kind: 'ok', groups: [unknown] }) }))
      await row('Apple Music').click()
      await expect
        .element(page.getByRole('link', { name: searchOn('Apple Music') }))
        .toHaveAttribute('href', appleSearch)
      expect(page.getByRole('button', { name: playResult(silver.title) }).elements()).toHaveLength(
        0,
      )
      expect(page.getByText(NO_RESULTS).elements()).toHaveLength(0)
    })

    it('says how long to wait when searches are rate limited', async () => {
      show(
        fakeEngine({
          searchRecordings: answering({ kind: 'rate_limited', retryAfterSeconds: 7 }),
        }),
      )
      await row('Apple Music').click()
      await expect.element(page.getByText(tooManySearches(7))).toBeVisible()
    })

    it('says when the search failed', async () => {
      show(fakeEngine({ searchRecordings: answering({ kind: 'failed' }) }))
      await row('Apple Music').click()
      await expect.element(page.getByText(SEARCH_FAILED)).toBeVisible()
    })

    it('refuses offline without searching', async () => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      const searchRecordings = appleAnswer()
      show(fakeEngine({ searchRecordings }))
      await row('Apple Music').click()
      await expect.element(page.getByText(SEARCH_NEEDS_CONNECTION)).toBeVisible()
      expect(searchRecordings).not.toHaveBeenCalled()
    })

    it('shows only the latest search when an earlier one answers last', async () => {
      const { pending, searchRecordings } = held()
      show(fakeEngine({ searchRecordings }))
      await row('Apple Music').click()
      await vi.waitFor(() => expect(pending).toHaveLength(1))
      await submit('second')
      await vi.waitFor(() => expect(pending).toHaveLength(2))
      pending[1]!({ kind: 'ok', groups: [{ ...apple, results: [harvest] }] })
      await expect
        .element(page.getByRole('button', { name: playResult(harvest.title) }))
        .toBeVisible()
      pending[0]!({ kind: 'ok', groups: [apple] })
      // Playing renders after the earlier answer has landed, so its results would show by then.
      await page.getByRole('button', { name: playResult(harvest.title) }).click()
      await expect.poll(playing).toEqual([embedFor(harvest, { autoplay: true })!.src])
      expect(page.getByRole('button', { name: playResult(silver.title) }).elements()).toHaveLength(
        0,
      )
    })

    it('drops a search that answers after the sheet closed', async () => {
      const { pending, searchRecordings } = held()
      const onClose = vi.fn()
      show(fakeEngine({ searchRecordings }), { onClose })
      await row('Apple Music').click()
      await vi.waitFor(() => expect(pending).toHaveLength(1))
      await page.getByRole('button', { name: 'Done', exact: true }).click()
      await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce())
      pending[0]!({ kind: 'ok', groups: [apple] })
      await page.getByRole('button', { name: 'Reopen', exact: true }).click()
      await expect.element(row('Apple Music')).toBeVisible()
      expect(document.body.textContent).not.toContain(harvest.title)
    })
  })

  describe('playing and linking', () => {
    it('plays one result at a time, inline', async () => {
      await searched(fakeEngine({ searchRecordings: appleAnswer() }))
      await page.getByRole('button', { name: playResult(silver.title) }).click()
      await vi.waitFor(() =>
        expect(frames().map((f) => f.src)).toEqual([embedFor(silver, { autoplay: true })!.src]),
      )
      await page.getByRole('button', { name: playResult(harvest.title) }).click()
      await vi.waitFor(() =>
        expect(frames().map((f) => f.src)).toEqual([embedFor(harvest, { autoplay: true })!.src]),
      )
    })

    it("stops the dock's item when a result starts playing", async () => {
      const player = fakePlayer({ item: { kind: 'recording', id: 'r1' } })
      await searched(fakeEngine({ searchRecordings: appleAnswer() }), player)
      expect(player.close).not.toHaveBeenCalled()
      await page.getByRole('button', { name: playResult(silver.title) }).click()
      await vi.waitFor(() => expect(frames()).toHaveLength(1))
      await expect.poll(() => vi.mocked(player.close).mock.calls.length).toBe(1)
    })

    it('stops playing on Back', async () => {
      await searched(fakeEngine({ searchRecordings: appleAnswer() }))
      await page.getByRole('button', { name: playResult(silver.title) }).click()
      await vi.waitFor(() => expect(frames()).toHaveLength(1))
      await page.getByRole('button', { name: BACK }).click()
      await vi.waitFor(() => expect(frames()).toHaveLength(0))
    })

    it('links a result with one tap and keeps it playing', async () => {
      await searched(fakeEngine({ searchRecordings: appleAnswer() }))
      await page.getByRole('button', { name: playResult(silver.title) }).click()
      await vi.waitFor(() => expect(frames()).toHaveLength(1))
      await page.getByRole('button', { name: linkResult(silver.title) }).click()
      await vi.waitFor(async () => expect(await db.recording_links.count()).toBe(1))
      const [link] = await db.recording_links.toArray()
      expect(link).toMatchObject({
        tune_id: tuneId,
        url: silver.url,
        provider: silver.provider,
        provider_ref: silver.provider_ref,
        title: silver.title,
        artwork_url: silver.artwork_url,
      })
      await expect
        .element(page.getByRole('button', { name: linkedResult(silver.title) }))
        .toBeDisabled()
      await expect.poll(playing).toEqual([embedFor(silver, { autoplay: true })!.src])
    })

    it('adds one link for a double tap', async () => {
      await searched(fakeEngine({ searchRecordings: appleAnswer() }))
      // Two clicks in one tick, before a render could disable the button between them.
      const link = page.getByRole('button', { name: linkResult(silver.title) }).element()
      ;(link as HTMLElement).click()
      ;(link as HTMLElement).click()
      await expect
        .element(page.getByRole('button', { name: linkedResult(silver.title) }))
        .toBeDisabled()
      // Every write a tap started has finished once each addLink call settles.
      await Promise.allSettled(vi.mocked(addLink).mock.results.map((result) => result.value))
      expect(await db.recording_links.count()).toBe(1)
    })

    it('shows a result this tune already links as linked, with Link disabled', async () => {
      await addLink(db, tuneId, { url: silver.url, provider: 'apple_music' })
      show(fakeEngine({ searchRecordings: appleAnswer() }))
      await row('Apple Music').click()
      await expect
        .element(page.getByRole('button', { name: linkedResult(silver.title) }))
        .toBeDisabled()
      await expect
        .element(page.getByRole('button', { name: linkResult(harvest.title) }))
        .toBeEnabled()
      expect(page.getByRole('button', { name: linkResult(silver.title) }).elements()).toHaveLength(
        0,
      )
    })
  })

  describe('opened on one service', () => {
    it('searches it once on opening, with no way back to a list', async () => {
      const searchRecordings = answering({
        kind: 'ok',
        groups: [{ ...apple, provider: 'tidal', search_url: tidalSearch }],
      })
      show(fakeEngine({ searchRecordings }), { service: 'tidal', strict: true })
      await expect.element(page.getByRole('dialog', { name: 'TIDAL' })).toBeInTheDocument()
      await expect
        .element(page.getByRole('button', { name: playResult(silver.title) }))
        .toBeVisible()
      expect(page.getByRole('button', { name: BACK }).elements()).toHaveLength(0)
      await playRendered()
      expect(searchRecordings.mock.calls).toEqual([
        ['The Silver Spear Reel', ['tidal'], deviceCountry()],
      ])
    })

    it('searches the title once when the tune arrives after the sheet opens', async () => {
      const tune = await db.tunes.get(tuneId)
      await db.tunes.delete(tuneId)
      const searchRecordings = appleAnswer()
      show(fakeEngine({ searchRecordings }), { service: 'apple_music', strict: true })
      await expect.element(page.getByRole('dialog', { name: 'Apple Music' })).toBeInTheDocument()
      await db.tunes.put(tune!)
      await expect.element(query()).toHaveValue('The Silver Spear Reel')
      await expect
        .element(page.getByRole('button', { name: playResult(silver.title) }))
        .toBeVisible()
      await playRendered()
      // One list of calls covers both a search before the tune arrived and a second after.
      expect(searchRecordings.mock.calls).toEqual([
        ['The Silver Spear Reel', ['apple_music'], deviceCountry()],
      ])
    })

    it('starts no search and shows no status for a tune that does not exist', async () => {
      await db.tunes.delete(tuneId)
      const searchRecordings = appleAnswer()
      show(fakeEngine({ searchRecordings }), { service: 'apple_music' })
      await expect.element(page.getByRole('dialog', { name: 'Apple Music' })).toBeInTheDocument()
      await expect.element(query()).toHaveValue('')
      expect(statusText()).not.toContain(SEARCHING)
      // Enter searches what was typed, so its search is the only one made.
      await submit('Silver Spear')
      await expect
        .poll(() => searchRecordings.mock.calls)
        .toEqual([['Silver Spear', ['apple_music'], deviceCountry()]])
    })

    it('makes one search when Enter comes before the tune loads', async () => {
      const tune = await db.tunes.get(tuneId)
      await db.tunes.delete(tuneId)
      const searchRecordings = appleAnswer()
      show(fakeEngine({ searchRecordings }), { service: 'apple_music' })
      await submit('Silver Spear Altan')
      await vi.waitFor(() => expect(searchRecordings).toHaveBeenCalledOnce())
      await db.tunes.put(tune!)
      // The sheet reads a tune and its links together, so a result showing as linked means the
      // sheet has read the tune that arrived before the link.
      await addLink(db, tuneId, { url: silver.url, provider: 'apple_music' })
      await expect
        .element(page.getByRole('button', { name: linkedResult(silver.title) }))
        .toBeDisabled()
      await playRendered()
      expect(searchRecordings.mock.calls).toEqual([
        ['Silver Spear Altan', ['apple_music'], deviceCountry()],
      ])
    })

    it('starts no opening search once the user typed before the tune loaded', async () => {
      const tune = await db.tunes.get(tuneId)
      await db.tunes.delete(tuneId)
      const searchRecordings = appleAnswer()
      show(fakeEngine({ searchRecordings }), { service: 'apple_music' })
      await expect.element(query()).toBeVisible()
      await query().fill('Silver Spear Altan')
      await db.tunes.put(tune!)
      expect(statusText()).not.toContain(SEARCHING)
      // Enter searches what was typed, so its search is the only one made.
      await submit()
      await expect
        .poll(() => searchRecordings.mock.calls)
        .toEqual([['Silver Spear Altan', ['apple_music'], deviceCountry()]])
    })

    it('searches once per opening when the tune changes while the sheet is open', async () => {
      const searchRecordings = appleAnswer()
      show(fakeEngine({ searchRecordings }), { service: 'apple_music' })
      await vi.waitFor(() => expect(searchRecordings).toHaveBeenCalledOnce())
      // A new prefill re-runs the opening search's effect within the same opening.
      await db.tunes.update(tuneId, { title: 'The Mason’s Apron' })
      await expect.element(query()).toHaveValue('The Mason’s Apron Reel')
      await playRendered()
      await expect.poll(() => searchRecordings.mock.calls.length).toBe(1)
    })

    it('drops a search from before the sheet closed that answers once it reopens', async () => {
      const { pending, searchRecordings } = held()
      const onClose = vi.fn()
      show(fakeEngine({ searchRecordings }), { onClose, service: 'apple_music' })
      await vi.waitFor(() => expect(pending).toHaveLength(1))
      await page.getByRole('button', { name: 'Done', exact: true }).click()
      await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce())
      await page.getByRole('button', { name: 'Reopen', exact: true }).click()
      await expect.element(query()).toHaveValue('The Silver Spear Reel')
      // Reopening searches its prefill again; the search from before the close answers first.
      await vi.waitFor(() => expect(pending).toHaveLength(2))
      pending[0]!({ kind: 'ok', groups: [apple] })
      // A new prefill renders after the earlier answer has landed, so its results would show
      // by then. The opening has already searched, so the prefill starts no search of its own.
      await db.tunes.update(tuneId, { tune_type: 'Jig' })
      await expect.element(query()).toHaveValue('The Silver Spear Jig')
      expect(page.getByRole('button', { name: playResult(silver.title) }).elements()).toHaveLength(
        0,
      )
      pending[1]!({ kind: 'ok', groups: [{ ...apple, results: [harvest] }] })
      await expect
        .element(page.getByRole('button', { name: playResult(harvest.title) }))
        .toBeVisible()
      expect(page.getByRole('button', { name: playResult(silver.title) }).elements()).toHaveLength(
        0,
      )
    })
  })
})
