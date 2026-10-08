import { renderHook } from '@testing-library/react'
import { useEffect, useMemo, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteList } from '../../commands/lists'
import { deleteTune, setArchived } from '../../commands/tunes'
import { DbContext } from '../../db/DbProvider'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalList, LocalListItem } from '../../db/types'
import { openTestDb } from '../../test/db'
import {
  dataProviders,
  FakeAudioElement,
  fakeEngine,
  fakePlaybackEngine,
} from '../../test/providers'
import type { SyncEngine } from '../../sync/types'
import { seeded } from '../../test/random'
import { recordingFile, recordingRow, tuneRow, userTuneRow } from '../../test/rows'
import { ListPlaybackProvider } from './ListPlaybackProvider'
import { readPlaylist } from './readPlaylist'
import type { PlaybackEngine } from './playbackEngine'
import { PlaybackEngineContext } from './PlaybackEngineProvider'
import { NOTHING_LEFT } from './playerCopy'
import type { PlayOrigin } from './playLog'
import { PlayerProvider } from './PlayerProvider'
import { useDockItem, type DockShown } from './useDockItem'
import { REPEAT_KEY, SHUFFLE_KEY, useListPlayback, type ListPlayback } from './useListPlayback'
import { PlayerContext, usePlayer, type Player, type PlayerItem } from './usePlayer'
import { useRecordingTransport } from './useRecordingTransport'

const AT = '2026-01-01T00:00:00.000Z'
const TUNES = ['t1', 't2', 't3'] as const

let db: CrosstuneDb
let element: FakeAudioElement
let engine: PlaybackEngine
let hook: { current: { api: ListPlayback; player: Player } }
let plays: { item: PlayerItem; origin: PlayOrigin | undefined }[]
/** Every call the tree made on the player, in order. */
let calls: string[]
/** The database the tree reads, which a test swaps to switch users. */
let shownDb: CrosstuneDb
/** While set, every list read waits for it. */
let hold: Promise<void> | null
/** The recording whose transport is mounted, so a test knows the engine is on it. */
const transport = { recording: null as string | null }

/** A gate a test opens to let held list reads finish. */
function holdReads(): () => void {
  let open = () => {}
  hold = new Promise<void>((resolve) => (open = resolve))
  return () => {
    hold = null
    open()
  }
}

/** Every list read the provider has asked for, so a test can wait for a held one to finish. */
let reads: Promise<unknown>[]

function heldRead(readDb: CrosstuneDb, listId: string) {
  const gate = hold
  const read = (async () => {
    if (gate) await gate
    return readPlaylist(readDb, listId)
  })()
  reads.push(read)
  return read
}

/** Thursday jam: three tunes, each with one take this device holds. */
async function seedList() {
  const row = { created_at: AT, updated_at: AT, deleted_at: null, server_seq: 0 }
  const list: LocalList = { id: 'l1', ...row, name: 'Thursday jam', position: 0 }
  for (const [index, tuneId] of TUNES.entries()) {
    await db.tunes.put(tuneRow(tuneId, `Tune ${index + 1}`))
    await db.user_tunes.put(userTuneRow(`u-${tuneId}`, tuneId))
    const recordingId = `r-${tuneId}`
    await db.recordings.put(
      recordingRow(recordingId, { tune_id: tuneId, duration_ms: 3000, source_duration_ms: 3000 }),
    )
    await db.recording_files.put(
      recordingFile(recordingId, {
        blob: new Blob(['x'], { type: 'audio/mp4' }),
        local_duration_ms: 3000,
      }),
    )
  }
  await db.lists.put(list)
  await db.list_items.bulkPut(
    TUNES.map((tuneId, position): LocalListItem => ({
      id: `i-${tuneId}`,
      ...row,
      list_id: 'l1',
      user_tune_id: `u-${tuneId}`,
      position,
    })),
  )
}

/** Passes every call through to the real player, recording what was played and from where. */
function SpyPlayer({ children }: { children: ReactNode }) {
  const real = usePlayer()
  const spied = useMemo<Player>(
    () => ({
      ...real,
      play: (item, origin) => {
        plays.push({ item, origin })
        calls.push(`play ${item.id}`)
        real.play(item, origin)
      },
      close: () => {
        calls.push('close')
        real.close()
      },
    }),
    [real],
  )
  return <PlayerContext.Provider value={spied}>{children}</PlayerContext.Provider>
}

/** Loads the player's recording into the engine, as the bar does. */
function Loader() {
  const { shown, title } = useDockItem()
  return shown?.kind === 'recording' ? (
    <Transport key={shown.recording.id} shown={shown} title={title} />
  ) : null
}

function Transport({
  shown,
  title,
}: {
  shown: Extract<DockShown, { kind: 'recording' }>
  title: string
}) {
  useRecordingTransport({ recording: shown.recording, file: shown.file, title, held: () => null })
  const id = shown.recording.id
  useEffect(() => {
    transport.recording = id
    return () => {
      transport.recording = null
    }
  }, [id])
  return null
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <DbContext.Provider value={shownDb}>
      <PlaybackEngineContext.Provider value={engine}>
        <PlayerProvider>
          <SpyPlayer>
            <ListPlaybackProvider random={seeded(7)} read={heldRead}>
              {children}
              <Loader />
            </ListPlaybackProvider>
          </SpyPlayer>
        </PlayerProvider>
      </PlaybackEngineContext.Provider>
    </DbContext.Provider>
  )
}

function mount(sync: Partial<SyncEngine> = {}) {
  const data = dataProviders({ db, engine: fakeEngine(sync) })
  const rendered = renderHook(() => ({ api: useListPlayback(), player: usePlayer() }), {
    wrapper: ({ children }) => data({ children: <Providers>{children}</Providers> }),
  })
  hook = rendered.result
  return rendered
}

const api = () => hook.current.api
const player = () => hook.current.player

const loadedId = () => player().item?.id ?? null

/** Waits for `recordingId` to load and play, so an end lands on it. */
async function playing(recordingId: string) {
  await expect.poll(loadedId).toBe(recordingId)
  await expect.poll(() => transport.recording).toBe(recordingId)
  await expect.poll(() => engine.getState().playing).toBe(true)
}

function endTune() {
  element.dispatchEvent(new Event('ended'))
}

beforeEach(async () => {
  db = openTestDb()
  element = new FakeAudioElement()
  engine = fakePlaybackEngine(element as unknown as HTMLAudioElement)
  plays = []
  calls = []
  hold = null
  reads = []
  transport.recording = null
  shownDb = db
  await seedList()
})

describe('ListPlayback', () => {
  it('plays the first tune with the list as its origin', async () => {
    mount()
    await api().start('l1', { shuffle: false })
    await playing('r-t1')
    expect(plays.at(-1)).toEqual({
      item: { kind: 'recording', id: 'r-t1' },
      origin: { context: 'list', listId: 'l1' },
    })
    await expect
      .poll(() => api().active)
      .toMatchObject({
        listId: 'l1',
        listName: 'Thursday jam',
        position: 1,
        count: 3,
        shuffled: false,
        repeat: 'off',
        message: null,
      })
  })

  it('closes what was playing before it starts', async () => {
    mount()
    player().play({ kind: 'recording', id: 'r-t3' })
    await playing('r-t3')
    await api().start('l1', { shuffle: false })
    await playing('r-t1')
    expect(calls).toEqual(['play r-t3', 'close', 'play r-t1'])
  })

  it('advances when the engine ends a tune', async () => {
    mount()
    await api().start('l1', { shuffle: false })
    await playing('r-t1')
    endTune()
    await playing('r-t2')
    await expect.poll(() => api().active?.position).toBe(2)
  })

  it('passes over a tune deleted before its turn and still counts it', async () => {
    mount()
    await api().start('l1', { shuffle: false })
    await playing('r-t1')
    await deleteTune(db, 't2')
    endTune()
    await playing('r-t3')
    await expect.poll(() => api().active).toMatchObject({ position: 3, count: 3, message: null })
  })

  it('passes over a tune archived while archived tunes are hidden', async () => {
    mount()
    await api().start('l1', { shuffle: false })
    await playing('r-t1')
    await setArchived(db, 'u-t2', true)
    endTune()
    await playing('r-t3')
    await expect.poll(() => api().active).toMatchObject({ position: 3, count: 3, message: null })
  })

  it('replays the tune on a natural end with repeat one', async () => {
    mount()
    await api().start('l1', { shuffle: false })
    await playing('r-t1')
    api().cycleRepeat()
    await expect.poll(() => api().active?.repeat).toBe('list')
    api().cycleRepeat()
    await expect.poll(() => api().active?.repeat).toBe('one')
    const replay = vi.spyOn(element, 'play')
    endTune()
    await expect.poll(() => replay.mock.calls.length).toBe(1)
    expect(loadedId()).toBe('r-t1')
    expect(api().active?.position).toBe(1)
  })

  it('leaves the last tune paused and stops the list at the end with repeat off', async () => {
    mount()
    await api().start('l1', { shuffle: false })
    await playing('r-t1')
    expect(api().jump('t3')).toBe(true)
    await playing('r-t3')
    endTune()
    await expect.poll(() => api().active).toBeNull()
    expect(loadedId()).toBe('r-t3')
    expect(engine.getState().playing).toBe(false)
  })

  it('refuses to jump to a tune the queue lacks', async () => {
    mount()
    await api().start('l1', { shuffle: false })
    await playing('r-t1')
    expect(api().jump('elsewhere')).toBe(false)
    expect(loadedId()).toBe('r-t1')
  })

  it('moves to the next tune and back on request', async () => {
    mount()
    await api().start('l1', { shuffle: false })
    await playing('r-t1')
    api().next()
    await playing('r-t2')
    await expect.poll(() => api().active?.position).toBe(2)
    api().previous()
    await playing('r-t1')
    await expect.poll(() => api().active?.position).toBe(1)
  })

  it('moves forward on a natural end after a step back', async () => {
    mount()
    await api().start('l1', { shuffle: false })
    await playing('r-t1')
    api().next()
    await playing('r-t2')
    api().previous()
    await playing('r-t1')
    endTune()
    await playing('r-t2')
  })

  it('moves forward when it passes over a tune after a step back', async () => {
    mount()
    await api().start('l1', { shuffle: false })
    await playing('r-t1')
    api().next()
    await playing('r-t2')
    api().previous()
    await playing('r-t1')
    await deleteTune(db, 't2')
    endTune()
    await playing('r-t3')
    await expect.poll(() => api().active?.position).toBe(3)
  })

  it('ends quietly when its list is deleted while it plays', async () => {
    mount()
    await api().start('l1', { shuffle: false })
    await playing('r-t1')
    // With repeat on, passing over every tune would stop the list with a message.
    api().cycleRepeat()
    await expect.poll(() => api().active?.repeat).toBe('list')
    await deleteList(db, 'l1')
    endTune()
    await expect.poll(() => api().active).toBeNull()
    expect(loadedId()).toBe('r-t1')
    expect(engine.getState().playing).toBe(false)
  })

  it('detaches when a catalog row plays something else', async () => {
    mount()
    await api().start('l1', { shuffle: false })
    await playing('r-t1')
    player().play({ kind: 'recording', id: 'r-t3' }, { context: 'row' })
    await expect.poll(() => api().active).toBeNull()
    await playing('r-t3')
  })

  it('detaches when another surface plays the same recording', async () => {
    mount()
    await api().start('l1', { shuffle: false })
    await playing('r-t1')
    player().play({ kind: 'recording', id: 'r-t1' }, { context: 'row' })
    await expect.poll(() => api().active).toBeNull()
  })

  it('detaches when the player closes', async () => {
    mount()
    await api().start('l1', { shuffle: false })
    await playing('r-t1')
    player().close()
    await expect.poll(() => api().active).toBeNull()
  })

  it('stops with a message when every remaining tune fails', async () => {
    mount()
    await api().start('l1', { shuffle: false })
    await playing('r-t1')
    const refuse = vi.spyOn(element, 'play').mockRejectedValue(new Error('refused'))
    endTune()
    await expect.poll(() => api().active?.message).toBe(NOTHING_LEFT)
    await expect.poll(() => player().item).toBeNull()
    // Both later tunes were tried before the list gave up.
    expect(refuse.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(api().active).toMatchObject({ listId: 'l1', count: 3 })
    api().end()
    await expect.poll(() => api().active).toBeNull()
  })

  it('keeps shuffle and repeat through a remount', async () => {
    const first = mount()
    await api().start('l1', { shuffle: true })
    await expect.poll(() => api().active?.shuffled).toBe(true)
    api().cycleRepeat()
    await expect.poll(() => api().active?.repeat).toBe('list')
    expect(localStorage.getItem(SHUFFLE_KEY)).toBe('true')
    expect(localStorage.getItem(REPEAT_KEY)).toBe('list')
    first.unmount()

    mount()
    await api().start('l1')
    await expect.poll(() => api().active).toMatchObject({ shuffled: true, repeat: 'list' })
  })

  it('writes shuffle off when the list plays in order', async () => {
    mount()
    await api().start('l1', { shuffle: true })
    await expect.poll(() => api().active?.shuffled).toBe(true)
    await api().start('l1', { shuffle: false })
    await expect.poll(() => api().active?.shuffled).toBe(false)
    expect(localStorage.getItem(SHUFFLE_KEY)).toBe('false')
    api().toggleShuffle()
    await expect.poll(() => api().active?.shuffled).toBe(true)
    expect(localStorage.getItem(SHUFFLE_KEY)).toBe('true')
  })

  it('gives way to a play elsewhere while it reads the list', async () => {
    mount()
    const open = holdReads()
    const started = api().start('l1', { shuffle: false })
    player().play({ kind: 'recording', id: 'r-t3' }, { context: 'row' })
    await expect.poll(loadedId).toBe('r-t3')
    open()
    await started
    expect(api().active).toBeNull()
    expect(loadedId()).toBe('r-t3')
    expect(calls).not.toContain('play r-t1')
  })

  it('moves twice for two quick nexts', async () => {
    mount()
    await api().start('l1', { shuffle: false })
    await playing('r-t1')
    const open = holdReads()
    api().next()
    api().next()
    await expect.poll(() => api().active?.position).toBe(3)
    open()
    await playing('r-t3')
    expect(calls).not.toContain('play r-t2')
  })

  it('keeps a shuffle chosen while a turn is pending', async () => {
    mount()
    await api().start('l1', { shuffle: false })
    await playing('r-t1')
    const open = holdReads()
    api().next()
    api().toggleShuffle()
    await expect.poll(() => api().active?.shuffled).toBe(true)
    open()
    await playing('r-t2')
    expect(api().active).toMatchObject({ shuffled: true, position: 2 })
    expect(localStorage.getItem(SHUFFLE_KEY)).toBe('true')
  })

  it('lets a natural end during a pending jump go by', async () => {
    mount()
    await api().start('l1', { shuffle: false })
    await playing('r-t1')
    const open = holdReads()
    expect(api().jump('t3')).toBe(true)
    endTune()
    open()
    await playing('r-t3')
    await expect.poll(() => api().active?.position).toBe(3)
    expect(calls).not.toContain('play r-t2')
  })

  it('does not hold a refusal from the tune before against the new one', async () => {
    mount()
    await api().start('l1', { shuffle: false })
    let refuse: (reason: Error) => void = () => {}
    const late = new Promise<void>((_, reject) => (refuse = reject))
    late.catch(() => {})
    // The next play starts, then is refused only after the tune after it has loaded.
    vi.spyOn(element, 'play').mockImplementationOnce(() => {
      element.paused = false
      element.dispatchEvent(new Event('play'))
      return late
    })
    api().jump('t1')
    await playing('r-t1')
    endTune()
    await playing('r-t2')
    refuse(new Error('aborted'))
    await late.catch(() => {})
    await Promise.resolve()
    expect(engine.getState().failed).toBe(false)
    expect(loadedId()).toBe('r-t2')
    expect(api().active?.position).toBe(2)
  })

  it('passes over a tune whose audio cannot be fetched', async () => {
    await db.recording_files.delete('r-t2')
    mount({ download: async () => null })
    await api().start('l1', { shuffle: false })
    await playing('r-t1')
    endTune()
    await playing('r-t3')
    expect(calls).toContain('play r-t2')
    expect(api().active).toMatchObject({ position: 3, message: null })
  })

  it('stops with a message when every remaining tune cannot be fetched', async () => {
    await db.recording_files.bulkDelete(['r-t2', 'r-t3'])
    mount({ download: async () => null })
    await api().start('l1', { shuffle: false })
    await playing('r-t1')
    endTune()
    await expect.poll(() => api().active?.message).toBe(NOTHING_LEFT)
    await expect.poll(() => player().item).toBeNull()
  })

  it('ends as usual when only passed-over tunes are left', async () => {
    mount()
    await api().start('l1', { shuffle: false })
    await playing('r-t1')
    await deleteTune(db, 't2')
    await setArchived(db, 'u-t3', true)
    endTune()
    await expect.poll(() => api().active).toBeNull()
    expect(loadedId()).toBe('r-t1')
    expect(engine.getState().playing).toBe(false)
  })

  it('drops a stopped list when the user switches', async () => {
    const rendered = mount()
    await api().start('l1', { shuffle: false })
    await playing('r-t1')
    vi.spyOn(element, 'play').mockRejectedValue(new Error('refused'))
    endTune()
    await expect.poll(() => api().active?.message).toBe(NOTHING_LEFT)
    shownDb = openTestDb()
    rendered.rerender()
    await expect.poll(() => api().active).toBeNull()
  })

  it('plays nothing once unmounted mid-read', async () => {
    const rendered = mount()
    const open = holdReads()
    const started = api().start('l1', { shuffle: false })
    rendered.unmount()
    open()
    await started
    expect(calls).not.toContain('play r-t1')
  })

  it('drops a start whose read outlives a user switch', async () => {
    const rendered = mount()
    const open = holdReads()
    const started = api().start('l1', { shuffle: false })
    shownDb = openTestDb()
    rendered.rerender()
    open()
    await started
    expect(api().active).toBeNull()
    expect(calls).not.toContain('play r-t1')
  })

  it('keeps a shuffle turned off when a step back finds nothing', async () => {
    mount()
    await api().start('l1', { shuffle: true })
    await expect.poll(() => api().active?.shuffled).toBe(true)
    expect(api().jump('t3')).toBe(true)
    await playing('r-t3')
    api().toggleShuffle()
    await expect.poll(() => api().active).toMatchObject({ shuffled: false, position: 3 })
    await deleteTune(db, 't1')
    await deleteTune(db, 't2')
    const seek = vi.spyOn(engine, 'seek')
    api().previous()
    await expect.poll(() => seek.mock.calls.length).toBe(1)
    expect(api().active).toMatchObject({ shuffled: false, position: 3 })
    expect(loadedId()).toBe('r-t3')
  })

  it('stops for a next past the end while a turn to the last tune is pending', async () => {
    mount()
    await api().start('l1', { shuffle: false })
    await playing('r-t1')
    const open = holdReads()
    expect(api().jump('t3')).toBe(true)
    api().next()
    await expect.poll(() => api().active).toBeNull()
    expect(engine.getState().playing).toBe(false)
    open()
    await Promise.all(reads)
    expect(calls).not.toContain('play r-t3')
    expect(loadedId()).toBe('r-t1')
  })
})
