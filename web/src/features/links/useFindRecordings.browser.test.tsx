import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchGroup, SearchResult } from '../../api/types'
import type { Provider } from '../../api/vocabulary'
import { recordingAnalytics } from '../../analytics/testing'
import { toggleSearchProvider } from '../../commands/settings'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import type { SyncEngine } from '../../sync/types'
import { openTestDb } from '../../test/db'
import { dataProviders, fakeEngine, fakePlayer } from '../../test/providers'
import { PlayerContext, type Player } from '../player/usePlayer'
import { SEARCHABLE_PROVIDERS } from '../settings/searchProviders'
import { deviceCountry } from './region'
import { useFindRecordings } from './useFindRecordings'

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
  artwork_url: null,
}

const apple: SearchGroup = {
  provider: 'apple_music',
  status: 'results',
  results: [silver],
  search_url: 'https://music.apple.com/search?term=silver',
}

function setup({
  service,
  searchRecordings = vi.fn<SyncEngine['searchRecordings']>(async () => ({
    kind: 'ok',
    groups: [apple],
  })),
  player = fakePlayer(),
  analytics = recordingAnalytics(),
}: {
  service?: Provider
  searchRecordings?: SyncEngine['searchRecordings']
  player?: Player
  analytics?: ReturnType<typeof recordingAnalytics>
} = {}) {
  const Data = dataProviders({ db, engine: fakeEngine({ searchRecordings }), analytics })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Data>
      <PlayerContext.Provider value={player}>{children}</PlayerContext.Provider>
    </Data>
  )
  const onClose = vi.fn()
  const onOpenSettings = vi.fn()
  const hook = renderHook(
    ({ target }: { target: string | null }) =>
      useFindRecordings(target, service, { onClose, onOpenSettings }),
    { wrapper, initialProps: { target: tuneId as string | null } },
  )
  return { ...hook, onClose, onOpenSettings, searchRecordings, player, analytics }
}

describe('useFindRecordings', () => {
  it('starts from the tune and searches nothing until a service is picked', async () => {
    const { result, searchRecordings } = setup()
    await expect.poll(() => result.current.ready).toBe(true)
    expect(result.current.text).toBe('The Silver Spear Reel')
    expect(result.current.shown).toBeNull()
    expect(searchRecordings).not.toHaveBeenCalled()
    act(() => result.current.pick('apple_music'))
    expect(result.current.shown).toBe('apple_music')
    await expect.poll(() => result.current.search).toEqual({ kind: 'ok', groups: [apple] })
    expect(searchRecordings).toHaveBeenCalledExactlyOnceWith(
      'The Silver Spear Reel',
      ['apple_music'],
      deviceCountry(),
    )
  })

  it('links a result once and reports it linked', async () => {
    const { result } = setup()
    await expect.poll(() => result.current.ready).toBe(true)
    expect(result.current.linked(silver.url)).toBe(false)
    act(() => {
      result.current.claim(silver)
      result.current.claim(silver)
    })
    expect(result.current.linked(silver.url)).toBe(true)
    await expect.poll(() => db.recording_links.count()).toBe(1)
  })

  it('goes back to the services, dropping the answer', async () => {
    const { result } = setup()
    await expect.poll(() => result.current.ready).toBe(true)
    act(() => result.current.pick('apple_music'))
    await expect.poll(() => result.current.search.kind).toBe('ok')
    act(() => result.current.back())
    expect(result.current.shown).toBeNull()
    expect(result.current.search).toEqual({ kind: 'idle' })
  })

  it('shows only the latest search when an earlier one answers last', async () => {
    const answers: ((outcome: Awaited<ReturnType<SyncEngine['searchRecordings']>>) => void)[] = []
    const searchRecordings = vi.fn<SyncEngine['searchRecordings']>(
      () => new Promise((resolve) => answers.push(resolve)),
    )
    const { result } = setup({ searchRecordings })
    await expect.poll(() => result.current.ready).toBe(true)
    act(() => result.current.pick('apple_music'))
    act(() => result.current.setQuery('Silver Spear Altan'))
    act(() => result.current.submit())
    expect(answers).toHaveLength(2)
    await act(async () => answers[1]!({ kind: 'ok', groups: [apple] }))
    await act(async () => answers[0]!({ kind: 'failed' }))
    expect(result.current.search).toEqual({ kind: 'ok', groups: [apple] })
  })

  it('drops a search that answers after the sheet closed', async () => {
    let answer: (outcome: Awaited<ReturnType<SyncEngine['searchRecordings']>>) => void = () => {}
    const searchRecordings = vi.fn<SyncEngine['searchRecordings']>(
      () =>
        new Promise((resolve) => {
          answer = resolve
        }),
    )
    const { result } = setup({ searchRecordings })
    await expect.poll(() => result.current.ready).toBe(true)
    act(() => result.current.pick('apple_music'))
    expect(result.current.search).toEqual({ kind: 'searching' })
    act(() => result.current.close())
    await act(async () => answer({ kind: 'ok', groups: [apple] }))
    expect(result.current.search).toEqual({ kind: 'searching' })
  })

  it('refuses a search offline without asking the server', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { result, searchRecordings } = setup()
    await expect.poll(() => result.current.ready).toBe(true)
    act(() => result.current.pick('apple_music'))
    expect(result.current.search).toEqual({ kind: 'offline' })
    expect(searchRecordings).not.toHaveBeenCalled()
  })

  it('searches the one service it opens on, once', async () => {
    const { result, searchRecordings } = setup({ service: 'apple_music' })
    expect(result.current.direct).toBe(true)
    await expect.poll(() => result.current.search.kind).toBe('ok')
    expect(searchRecordings).toHaveBeenCalledOnce()
  })

  it('stops what the player plays when a result starts', async () => {
    const player = fakePlayer({ item: { kind: 'link', id: 'l1' } })
    const { result } = setup({ player })
    act(() => result.current.setPlaying('one'))
    expect(result.current.playing).toBe('one')
    expect(player.close).toHaveBeenCalledOnce()
  })

  it('opens settings only once the sheet has gone', async () => {
    for (const provider of SEARCHABLE_PROVIDERS) {
      await toggleSearchProvider(db, 'user_1', provider, false)
    }
    const { result, onClose, onOpenSettings } = setup()
    await expect.poll(() => result.current.providers?.size).toBe(0)
    act(() => result.current.openSettings())
    expect(result.current.open).toBe(false)
    expect(onOpenSettings).not.toHaveBeenCalled()
    act(() => result.current.dismissed())
    expect(onClose).toHaveBeenCalledOnce()
    expect(onOpenSettings).toHaveBeenCalledOnce()
  })

  it('reports a claimed result as a link added via find', async () => {
    const { result, analytics } = setup()
    await expect.poll(() => result.current.ready).toBe(true)
    act(() => {
      result.current.claim(silver)
      result.current.claim(silver)
    })
    await expect.poll(() => analytics.sends()).toHaveLength(1)
    const [link] = await db.recording_links.toArray()
    expect(analytics.sends()).toEqual([
      {
        name: 'link_added',
        props: { service: 'apple_music', via: 'find', link_id: link!.id, tune_id: tuneId },
      },
    ])
  })

  it('reports an in-app search with the bucketed count of its results', async () => {
    const { result, analytics } = setup()
    await expect.poll(() => result.current.ready).toBe(true)
    act(() => result.current.pick('apple_music'))
    await expect.poll(() => analytics.sends()).toHaveLength(1)
    expect(analytics.sends()).toEqual([
      {
        name: 'find_recordings_used',
        props: { service: 'apple_music', result_count_bucket: '1-9' },
      },
    ])
  })

  it('reports an in-app search that found nothing as zero', async () => {
    const searchRecordings = vi.fn<SyncEngine['searchRecordings']>(async () => ({
      kind: 'ok',
      groups: [],
    }))
    const { result, analytics } = setup({ searchRecordings })
    await expect.poll(() => result.current.ready).toBe(true)
    act(() => result.current.pick('apple_music'))
    await expect.poll(() => analytics.sends()).toHaveLength(1)
    expect(analytics.sends()).toEqual([
      { name: 'find_recordings_used', props: { service: 'apple_music', result_count_bucket: '0' } },
    ])
  })

  it('reports no search that failed', async () => {
    const searchRecordings = vi.fn<SyncEngine['searchRecordings']>(async () => ({
      kind: 'failed',
    }))
    const { result, analytics } = setup({ searchRecordings })
    await expect.poll(() => result.current.ready).toBe(true)
    act(() => result.current.pick('apple_music'))
    await expect.poll(() => result.current.search.kind).toBe('failed')
    expect(analytics.sends()).toEqual([])
  })

  it('reports a service opened on its own site without a count', async () => {
    const tab = {
      opener: {} as unknown,
      document: document.implementation.createHTMLDocument(),
      close: vi.fn(),
      closed: false,
    }
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    const searchRecordings = vi.fn<SyncEngine['searchRecordings']>(async () => ({
      kind: 'ok',
      groups: [
        {
          provider: 'spotify',
          status: 'search_only',
          results: [],
          search_url: 'https://open.spotify.com/search/silver',
        },
      ],
    }))
    const { result, analytics } = setup({ searchRecordings })
    await expect.poll(() => result.current.ready).toBe(true)
    act(() => result.current.pick('spotify'))
    await expect.poll(() => analytics.sends()).toHaveLength(1)
    expect(analytics.sends()).toEqual([
      { name: 'find_recordings_used', props: { service: 'spotify' } },
    ])
  })

  it('reports no own-site search that could not open', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    const { result, analytics } = setup()
    await expect.poll(() => result.current.ready).toBe(true)
    act(() => result.current.pick('spotify'))
    await expect.poll(() => result.current.notice).not.toBeNull()
    expect(analytics.sends()).toEqual([])
  })
})
