import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSong } from '../commands/songs'
import type { CrosstuneDb } from '../db/schema'
import { openTestDb } from '../test/db'
import { startSyncTriggers, WRITE_DEBOUNCE_MS } from './triggers'
import type { SyncEngine } from './types'

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
    resolveLink: async () => null,
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
    await createSong(db, { title: 'A' }, { status: 'known' })
    await createSong(db, { title: 'B' }, { status: 'known' })
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
    await createSong(db, { title: 'A' }, { status: 'known' })
    await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThan(0))
    stop()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS)
    expect(engine.calls).toBe(1)
  })
})
