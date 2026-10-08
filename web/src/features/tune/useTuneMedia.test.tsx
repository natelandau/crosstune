import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as commands from '../../commands/links'
import { addLink } from '../../commands/links'
import { toggleSearchProvider } from '../../commands/settings'
import { createTune } from '../../commands/tunes'
import { PROVIDER_LABELS } from '../../constants'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { captureRecording } from '../../test/recordings'
import { dataProviders, fakeEngine, fakePlayer, testSession } from '../../test/providers'
import { PlayerContext } from '../player/usePlayer'
import {
  ADD_TO_RECORDINGS,
  FIND_RECORDINGS,
  SEARCH_NEEDS_CONNECTION,
  searchService,
} from '../links/findRecordingsCopy'
import { SEARCHABLE_PROVIDERS } from '../settings/searchProviders'
import { NEW_RECORDING } from '../capture/recordCopy'
import { PASTE_LINK } from '../links/pasteLinkCopy'
import { useRecordingsWithFiles } from '../recordings/useRecordings'
import { DONT_PLAY_FIRST, PLAY_FIRST_IN_LISTS } from './playSourceText'
import { useTune } from './useTune'
import { useTuneMedia } from './useTuneMedia'

vi.mock('../../commands/links', { spy: true })

let db: CrosstuneDb
let ids: { tuneId: string; userTuneId: string }

beforeEach(async () => {
  db = openTestDb()
  ids = await createTune(db, { title: "Soldier's Joy", tune_type: 'reel' }, { status: 'learning' })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function mount({
  start = vi.fn(),
  engine = fakeEngine(),
}: { start?: (id: string) => void; engine?: ReturnType<typeof fakeEngine> } = {}) {
  const Data = dataProviders({ db, engine })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Data>
      <PlayerContext.Provider value={fakePlayer()}>{children}</PlayerContext.Provider>
    </Data>
  )
  const hook = renderHook(
    ({ id }: { id: string }) => {
      const recordings = useRecordingsWithFiles({ tuneId: id })
      const view = useTune(id)
      const media = useTuneMedia(id, {
        recordings: recordings ?? [],
        links: view?.links ?? [],
        confirm: async () => true,
        startRecording: start,
      })
      return { media, ready: recordings !== undefined && !!view }
    },
    { wrapper, initialProps: { id: ids.tuneId } },
  )
  return { ...hook, start }
}

const label = (action: { label: string }) => action.label

describe('useTuneMedia', () => {
  it('is empty until the tune has a recording or a link', async () => {
    const { result } = mount()
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.media.empty).toBe(true)
    await addLink(db, ids.tuneId, { url: 'https://example.com/a', provider: 'other' })
    await waitFor(() => expect(result.current.media.empty).toBe(false))
    expect(result.current.media.linkRows).toHaveLength(1)
  })

  it('lists a recording row with its actions and its pinned state', async () => {
    const id = await captureRecording(db, { tuneId: ids.tuneId })
    const { result } = mount()
    await waitFor(() => expect(result.current.media.recordingRows).toHaveLength(1))
    const [row] = result.current.media.recordingRows
    expect(row!.view.recording.id).toBe(id)
    expect(row!.pinned).toBe(false)
    expect(row!.actions.map(label)).toContain(PLAY_FIRST_IN_LISTS)
  })

  it('pins and unpins a link, and reports it as pinned', async () => {
    const linkId = await addLink(db, ids.tuneId, {
      url: 'https://example.com/a',
      provider: 'other',
    })
    const { result } = mount()
    await waitFor(() => expect(result.current.media.linkRows).toHaveLength(1))
    await act(async () => {
      result.current.media.linkRows[0]!.actions.find(
        (a) => a.label === PLAY_FIRST_IN_LISTS,
      )!.onPress()
    })
    await waitFor(() => expect(result.current.media.linkRows[0]!.pinned).toBe(true))
    expect((await db.user_tunes.get(ids.userTuneId))?.play_link_id).toBe(linkId)
    expect(result.current.media.linkRows[0]!.actions.map(label)).toContain(DONT_PLAY_FIRST)
  })

  it('offers Add to recordings only for a link whose audio is not yet saved', async () => {
    await addLink(db, ids.tuneId, {
      url: 'https://www.slippery-hill.com/recording/1',
      provider: 'slippery_hill',
      provider_ref: '1',
    })
    await addLink(db, ids.tuneId, { url: 'https://example.com/a', provider: 'other' })
    const { result } = mount()
    await waitFor(() => expect(result.current.media.linkRows).toHaveLength(2))
    const names = result.current.media.linkRows.map((row) => row.actions.map(label))
    expect(names.filter((n) => n.includes(ADD_TO_RECORDINGS))).toHaveLength(1)
  })

  it('names the ways to add: record, paste, and find, which needs a connection', async () => {
    const { result, start } = mount()
    await waitFor(() => expect(result.current.ready).toBe(true))
    const { addItems } = result.current.media
    expect(addItems.map(label)).toEqual([NEW_RECORDING, PASTE_LINK, FIND_RECORDINGS])
    expect(addItems[2]!.refused).toBeUndefined()
    act(() => addItems[0]!.onPress())
    expect(start).toHaveBeenCalledWith(ids.tuneId)
    act(() => addItems[1]!.onPress())
    expect(result.current.media.pasting).toBe(true)
    act(() => result.current.media.setPasting(false))
    act(() => addItems[2]!.onPress())
    expect(result.current.media.finding).toBe(true)
  })

  it('refuses Find while offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { result } = mount()
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.media.addItems[2]!.refused).toBe(SEARCH_NEEDS_CONNECTION)
  })

  it('goes straight to the one chosen service, searching from the tune title and type', async () => {
    for (const provider of SEARCHABLE_PROVIDERS.filter((p) => p !== 'youtube')) {
      await toggleSearchProvider(db, testSession.userId, provider, false)
    }
    const searchRecordings = vi.fn(async (_query: string, ..._rest: unknown[]) => ({
      kind: 'failed' as const,
    }))
    const open = vi
      .spyOn(window, 'open')
      .mockReturnValue({ closed: false, location: { href: '' } } as unknown as Window)
    const { result } = mount({ engine: fakeEngine({ searchRecordings }) })
    await waitFor(() => expect(result.current.media.only).toBe('youtube'))
    await waitFor(() =>
      expect(result.current.media.addItems[2]!.label).toBe(searchService(PROVIDER_LABELS.youtube)),
    )
    expect(result.current.media.addItems[2]!.opensTab).toBe(true)
    // The prefill is read ahead of the tap, so the tap waits until it has landed.
    await waitFor(() => expect(result.current.media.prefill).toBe("Soldier's Joy reel"))
    await act(async () => result.current.media.addItems[2]!.onPress())
    await waitFor(() => expect(searchRecordings).toHaveBeenCalledTimes(1))
    expect(open).toHaveBeenCalledTimes(1)
    expect(searchRecordings.mock.calls[0]![0]).toBe("Soldier's Joy reel")
  })

  it('offers no pin once the tune row is gone', async () => {
    await addLink(db, ids.tuneId, { url: 'https://example.com/a', provider: 'other' })
    const { result } = mount()
    await waitFor(() => expect(result.current.media.linkRows).toHaveLength(1))
    await db.user_tunes.update(ids.userTuneId, { deleted_at: '2026-01-02T00:00:00.000Z' })
    await waitFor(() => expect(result.current.media.userTune).toBeUndefined())
    for (const row of result.current.media.linkRows) {
      expect(row.actions.map(label)).not.toContain(PLAY_FIRST_IN_LISTS)
    }
  })

  it('closes every sheet and clears the error line when another tune opens', async () => {
    const other = await createTune(db, { title: 'Angeline' }, { status: 'known' })
    await addLink(db, ids.tuneId, { url: 'https://example.com/a', provider: 'other' })
    vi.spyOn(commands, 'removeLink').mockRejectedValueOnce(new Error('Remove refused'))
    const { result, rerender } = mount()
    await waitFor(() => expect(result.current.media.linkRows).toHaveLength(1))
    await act(async () => {
      result.current.media.linkRows[0]!.actions.find((a) => a.label === 'Remove')!.onPress()
    })
    await waitFor(() => expect(result.current.media.error).toBe('Remove refused'))
    act(() => result.current.media.setPasting(true))
    act(() => result.current.media.setFinding(true))
    expect(result.current.media.pasting).toBe(true)
    rerender({ id: other.tuneId })
    expect(result.current.media.error).toBeNull()
    expect(result.current.media.pasting).toBe(false)
    expect(result.current.media.finding).toBe(false)
    expect(result.current.media.editing).toBeNull()
  })

  it('shows no refusal from the old tune once another tune is open', async () => {
    const other = await createTune(db, { title: 'Angeline' }, { status: 'known' })
    await addLink(db, ids.tuneId, { url: 'https://example.com/a', provider: 'other' })
    let refuse: () => void = () => {}
    const removal = vi.spyOn(commands, 'removeLink').mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          refuse = () => reject(new Error('Remove refused'))
        }),
    )
    const { result, rerender } = mount()
    await waitFor(() => expect(result.current.media.linkRows).toHaveLength(1))
    act(() => {
      result.current.media.linkRows[0]!.actions.find((a) => a.label === 'Remove')!.onPress()
    })
    await waitFor(() => expect(removal).toHaveBeenCalledTimes(1))
    rerender({ id: other.tuneId })
    await waitFor(() => expect(result.current.media.linkRows).toHaveLength(0))
    expect(result.current.media.pending).toBe(true)
    act(() => refuse())
    // Pending falling means the old action has settled, so a late error would be showing.
    await waitFor(() => expect(result.current.media.pending).toBe(false))
    expect(result.current.media.error).toBeNull()
  })
})
