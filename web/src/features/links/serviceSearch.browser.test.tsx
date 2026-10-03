import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SyncEngine } from '../../sync/types'
import { fakeEngine } from '../../test/providers'
import { SEARCH_FAILED, allowPopups, tooManySearches } from './findRecordingsCopy'
import { deviceCountry } from './region'
import { openServiceSearch, searchesInApp } from './serviceSearch'

const spotifySearch = 'https://open.spotify.com/search/silver'

/** A stand-in for the blank tab the search opens, with a document that navigates nowhere. */
function fakeTab() {
  return {
    opener: {} as unknown,
    document: document.implementation.createHTMLDocument(),
    close: vi.fn(),
    closed: false,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('searchesInApp', () => {
  it('searches Apple Music, TIDAL, and the Internet Archive in the app, and nothing else', () => {
    expect(searchesInApp('apple_music')).toBe(true)
    expect(searchesInApp('tidal')).toBe(true)
    expect(searchesInApp('internet_archive')).toBe(true)
    for (const provider of ['youtube', 'spotify', 'bandcamp', 'soundcloud'] as const) {
      expect(searchesInApp(provider)).toBe(false)
    }
  })
})

describe('openServiceSearch', () => {
  it("opens a tab during the tap and sends it to the service's own search page", async () => {
    const tab = fakeTab()
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    const searchRecordings = vi.fn<SyncEngine['searchRecordings']>(async () => ({
      kind: 'ok',
      groups: [
        { provider: 'spotify', status: 'search_only', results: [], search_url: spotifySearch },
      ],
    }))
    const pending = openServiceSearch(
      fakeEngine({ searchRecordings }),
      'Silver Spear',
      'spotify',
      'Spotify',
    )
    // Before the search answers, so the browser counts the tab as opened by the tap.
    expect(open).toHaveBeenCalledOnce()
    expect(await pending).toBeNull()
    expect(searchRecordings).toHaveBeenCalledWith('Silver Spear', ['spotify'], deviceCountry())
    expect(tab.opener).toBeNull()
    const link = tab.document.querySelector('a')!
    expect(link.href).toBe(spotifySearch)
    expect(link.rel).toBe('noreferrer')
    expect(tab.close).not.toHaveBeenCalled()
  })

  it('closes the tab and says why when the search fails', async () => {
    const tab = fakeTab()
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    const engine = fakeEngine({ searchRecordings: async () => ({ kind: 'failed' }) })
    expect(await openServiceSearch(engine, 'Silver Spear', 'spotify', 'Spotify')).toBe(
      SEARCH_FAILED,
    )
    expect(tab.close).toHaveBeenCalledOnce()
  })

  it('says how long to wait when searches are rate limited', async () => {
    vi.spyOn(window, 'open').mockReturnValue(fakeTab() as unknown as Window)
    const engine = fakeEngine({
      searchRecordings: async () => ({ kind: 'rate_limited', retryAfterSeconds: 4 }),
    })
    expect(await openServiceSearch(engine, 'Silver Spear', 'spotify', 'Spotify')).toBe(
      tooManySearches(4),
    )
  })

  it('says to allow pop-ups when the blank tab was blocked, without asking again', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const searchRecordings = vi.fn<SyncEngine['searchRecordings']>()
    const engine = fakeEngine({ searchRecordings })
    expect(await openServiceSearch(engine, 'Silver Spear', 'spotify', 'Spotify')).toBe(
      allowPopups('Spotify'),
    )
    expect(open).toHaveBeenCalledOnce()
    expect(searchRecordings).not.toHaveBeenCalled()
  })

  it('treats a tab closed before the answer as a cancel', async () => {
    const tab = fakeTab()
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    const engine = fakeEngine({
      searchRecordings: async () => {
        tab.closed = true
        return {
          kind: 'ok',
          groups: [
            { provider: 'spotify', status: 'search_only', results: [], search_url: spotifySearch },
          ],
        }
      },
    })
    expect(await openServiceSearch(engine, 'Silver Spear', 'spotify', 'Spotify')).toBeNull()
    expect(tab.document.querySelector('a')).toBeNull()
  })

  it('treats a tab that throws as closed meanwhile as a cancel', async () => {
    const tab = fakeTab()
    Object.defineProperty(tab, 'document', {
      get() {
        tab.closed = true
        throw new Error('closed')
      },
    })
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    const engine = fakeEngine({
      searchRecordings: async () => ({
        kind: 'ok',
        groups: [
          { provider: 'spotify', status: 'search_only', results: [], search_url: spotifySearch },
        ],
      }),
    })
    expect(await openServiceSearch(engine, 'Silver Spear', 'spotify', 'Spotify')).toBeNull()
  })

  it('opens nothing for a blank query', async () => {
    const open = vi.spyOn(window, 'open')
    const searchRecordings = vi.fn<SyncEngine['searchRecordings']>()
    const engine = fakeEngine({ searchRecordings })
    expect(await openServiceSearch(engine, '  ', 'spotify', 'Spotify')).toBeNull()
    expect(open).not.toHaveBeenCalled()
    expect(searchRecordings).not.toHaveBeenCalled()
  })
})
