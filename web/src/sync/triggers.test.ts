import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTune } from '../commands/tunes'
import type { CrosstuneDb } from '../db/schema'
import type { LocalRecording } from '../db/types'
import { openTestDb } from '../test/db'
import { PROCESSING_POLL_MS, startSyncTriggers, WRITE_DEBOUNCE_MS } from './triggers'
import type { SyncEngine } from './types'

function processingRecording(overrides: Partial<LocalRecording> = {}): LocalRecording {
  return {
    id: 'r1',
    created_at: '2026-09-14T00:00:00.000Z',
    updated_at: '2026-09-14T00:00:00.000Z',
    deleted_at: null,
    server_seq: 1,
    tune_id: null,
    label: null,
    source: 'microphone',
    recorded_at: '2026-09-14T00:00:00.000Z',
    position: 0,
    state: 'processing',
    duration_ms: null,
    playback_mime: null,
    playback_bytes: null,
    error: null,
    ...overrides,
  }
}

let db: CrosstuneDb

function fakeEngine(): SyncEngine & { calls: number } {
  const engine = {
    calls: 0,
    sync: vi.fn(async () => {
      engine.calls++
    }),
    status: () => 'idle' as const,
    lastSyncedAt: () => null,
    subscribe: () => () => {},
    transfer: async () => {},
    transferStatus: () => 'idle' as const,
    subscribeTransfer: () => () => {},
    resolveLink: async () => null,
    download: async () => null,
    retry: async () => {},
    stop: () => {},
    resume: () => {},
  }
  return engine
}

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  vi.useRealTimers()
  await db.delete()
})

describe('startSyncTriggers', () => {
  it('syncs on start, on reconnect, and when the tab becomes visible', async () => {
    const engine = fakeEngine()
    const stop = startSyncTriggers(engine, db)
    expect(engine.calls).toBe(1)
    window.dispatchEvent(new Event('online'))
    expect(engine.calls).toBe(2)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(engine.calls).toBe(3)
    stop()
    window.dispatchEvent(new Event('online'))
    expect(engine.calls).toBe(3)
  })

  it('ignores a visibilitychange that hides the tab', async () => {
    const engine = fakeEngine()
    const stop = startSyncTriggers(engine, db)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(engine.calls).toBe(1)
    stop()
  })

  it('debounces a sync after local writes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const engine = fakeEngine()
    const stop = startSyncTriggers(engine, db, { debounceMs: WRITE_DEBOUNCE_MS })
    await createTune(db, { title: 'A' }, { status: 'known' })
    await createTune(db, { title: 'B' }, { status: 'known' })
    // The live query observes the outbox asynchronously; wait for the debounce timer to exist.
    await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThan(0))
    expect(engine.calls).toBe(1)
    await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS)
    expect(engine.calls).toBe(2)
    stop()
  })

  it('cancels a pending debounce when it stops', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const engine = fakeEngine()
    const stop = startSyncTriggers(engine, db, { debounceMs: WRITE_DEBOUNCE_MS })
    await createTune(db, { title: 'A' }, { status: 'known' })
    await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThan(0))
    stop()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS)
    expect(engine.calls).toBe(1)
  })

  it('polls while a live recording is uploaded or processing and stops once none remain', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    await db.recordings.put(processingRecording({ id: 'r1', state: 'uploaded' }))
    const engine = fakeEngine()
    const stop = startSyncTriggers(engine, db)
    await vi.waitFor(() => expect(engine.calls).toBe(1))
    // The processing liveQuery resolves asynchronously; wait for its poll timer to exist.
    await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThan(0))

    await vi.advanceTimersByTimeAsync(PROCESSING_POLL_MS)
    expect(engine.calls).toBe(2)
    await vi.advanceTimersByTimeAsync(PROCESSING_POLL_MS)
    expect(engine.calls).toBe(3)

    await db.recordings.update('r1', { state: 'ready' })
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(0))
    await vi.advanceTimersByTimeAsync(PROCESSING_POLL_MS)
    expect(engine.calls).toBe(3)
    stop()
  })

  it('does not poll a processing recording while the tab is hidden', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await db.recordings.put(processingRecording({ id: 'r1', state: 'processing' }))
    const engine = fakeEngine()
    const stop = startSyncTriggers(engine, db)
    await vi.waitFor(() => expect(engine.calls).toBe(1))
    await vi.advanceTimersByTimeAsync(PROCESSING_POLL_MS * 2)
    expect(engine.calls).toBe(1)
    stop()
  })
})
