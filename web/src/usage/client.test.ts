import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { noopAnalytics, startAnalytics, USER_KEY, type PostHogLike } from './client'
import { WEB_POSTHOG_CONFIG } from './config'
import { scrubEvent } from './scrub'
import { SHARE_USAGE_KEY } from './usageSharing'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  const sets: [string, string][] = []
  const storage: Storage = {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => {
      sets.push([key, value])
      data.set(key, value)
    },
  }
  return { storage, sets }
}

type Call = [method: string, ...args: unknown[]]

function fakePostHog() {
  const calls: Call[] = []
  const record =
    (method: string) =>
    (...args: unknown[]) =>
      void calls.push([method, ...args])
  const ph: PostHogLike = {
    init: record('init'),
    register: record('register'),
    capture: record('capture'),
    identify: record('identify'),
    setPersonProperties: record('setPersonProperties'),
    reset: record('reset'),
    opt_in_capturing: record('opt_in_capturing'),
    opt_out_capturing: record('opt_out_capturing'),
  }
  return { ph, calls, methods: () => calls.map(([method]) => method) }
}

const SUPER = { product: 'app', platform: 'web' }

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('screen', { width: 1280, height: 800 })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function setup(initial: Record<string, string> = {}) {
  const fake = fakePostHog()
  const { storage, sets } = memoryStorage(initial)
  const load = vi.fn(() => Promise.resolve(fake.ph))
  const client = startAnalytics({ key: 'phc_test', storage, load })
  return { ...fake, storage, sets, load, client }
}

describe('startAnalytics', () => {
  it('returns noop without a key', () => {
    expect(startAnalytics({})).toBe(noopAnalytics)
  })

  it('does not import the SDK when sharing is off', async () => {
    const { client, load } = setup({ [SHARE_USAGE_KEY]: 'false' })
    client.send('signed_out', {})
    client.screen('catalog')
    client.identify('u1', {})
    client.reset()
    expect(load).not.toHaveBeenCalled()
  })

  it('registers super properties after init and after reset', async () => {
    const { client, calls } = setup()
    await client.enableSharing()
    client.reset()
    await client.enableSharing()
    const registers = calls.filter(([method]) => method === 'register')
    expect(registers[0]?.[1]).toMatchObject(SUPER)
    expect(calls[0]?.[0]).toBe('init')
    expect(calls[1]?.[0]).toBe('register')
    const reset = calls.findIndex(([method]) => method === 'reset')
    expect(calls[reset + 1]).toEqual(['register', expect.objectContaining(SUPER)])
  })

  it('init passes the scrubber as before_send', async () => {
    const { client, calls } = setup()
    await client.enableSharing()
    const init = calls.find(([method]) => method === 'init')
    expect(init?.[1]).toBe('phc_test')
    expect((init?.[2] as { before_send: unknown }).before_send).toBe(scrubEvent)
    expect(init?.[2]).toBe(WEB_POSTHOG_CONFIG)
  })

  it('screen sends $screen with the screen property', async () => {
    const { client, calls } = setup()
    client.screen('catalog')
    await client.enableSharing()
    expect(calls).toContainEqual([
      'capture',
      '$screen',
      { $screen_name: 'catalog', screen: 'catalog' },
    ])
  })

  it('send captures the event with its properties', async () => {
    const { client, calls } = setup()
    client.send('tune_archived', { tune_id: 't1' })
    await client.enableSharing()
    expect(calls).toContainEqual(['capture', 'tune_archived', { tune_id: 't1' }])
  })

  it('setting_changed sets its person property', async () => {
    const { client, calls } = setup()
    client.send('setting_changed', { setting: 'appearance', value: 'dark' })
    await client.enableSharing()
    expect(calls).toContainEqual([
      'capture',
      'setting_changed',
      { setting: 'appearance', value: 'dark', $set: { setting_appearance: 'dark' } },
    ])
  })

  it('identify sends person properties, sets signed_up_at once, and remembers the user', async () => {
    const { client, calls, storage } = setup()
    client.identify('u1', { catalog_size: '1-10' } as never, '2026-01-01T00:00:00Z')
    await client.enableSharing()
    expect(calls).toContainEqual([
      'identify',
      'u1',
      { catalog_size: '1-10' },
      { signed_up_at: '2026-01-01T00:00:00Z' },
    ])
    expect(storage.getItem(USER_KEY)).toBe('u1')
    expect(client.identifiedUser()).toBe('u1')
    client.reset()
    expect(storage.getItem(USER_KEY)).toBeNull()
    expect(client.identifiedUser()).toBeNull()
  })

  it('reads the remembered user from its own storage', () => {
    const { client } = setup({ [USER_KEY]: 'u0' })
    expect(client.identifiedUser()).toBe('u0')
    expect(noopAnalytics.identifiedUser()).toBeNull()
  })

  it('setPerson sets person properties', async () => {
    const { client, calls } = setup()
    client.setPerson({ setting_text_size: 3 })
    await client.enableSharing()
    expect(calls).toContainEqual(['setPersonProperties', { setting_text_size: 3 }])
  })

  it('disableSharing sends usage_sharing_disabled, then opts out, then stores off', async () => {
    const { client, calls, sets } = setup()
    await client.enableSharing()
    calls.length = 0
    sets.length = 0
    await client.disableSharing()
    expect(calls).toEqual([
      ['capture', 'usage_sharing_disabled', {}, { send_instantly: true }],
      ['opt_out_capturing'],
    ])
    expect(sets).toEqual([[SHARE_USAGE_KEY, 'false']])
    calls.length = 0
    client.send('signed_out', {})
    expect(calls).toEqual([])
  })

  it('enableSharing loads and replays the remembered identify', async () => {
    const { client, calls, load } = setup({ [SHARE_USAGE_KEY]: 'false' })
    client.identify('u1', {}, '2026-01-01T00:00:00Z')
    expect(load).not.toHaveBeenCalled()
    await client.enableSharing()
    expect(load).toHaveBeenCalledTimes(1)
    const methods = calls.map(([method]) => method)
    expect(methods).toContain('opt_in_capturing')
    expect(calls).toContainEqual(['identify', 'u1', {}, { signed_up_at: '2026-01-01T00:00:00Z' }])
  })

  it('enableSharing while sharing is on neither opts in nor identifies again', async () => {
    const { client, methods } = setup()
    client.identify('u1', {})
    await client.enableSharing()
    await client.enableSharing()
    expect(methods().filter((m) => m === 'identify')).toEqual(['identify'])
    expect(methods()).not.toContain('opt_in_capturing')
  })

  it('stays opted out through a reset while sharing is off', async () => {
    const { client, calls } = setup()
    await client.enableSharing()
    await client.disableSharing()
    calls.length = 0
    client.reset()
    await expect
      .poll(() => calls.map(([method]) => method))
      .toEqual(['reset', 'register', 'opt_out_capturing'])
  })

  it('never lets an SDK failure reach the app', async () => {
    const fake = fakePostHog()
    fake.ph.capture = () => {
      throw new Error('boom')
    }
    const { storage } = memoryStorage()
    const client = startAnalytics({ key: 'k', storage, load: () => Promise.resolve(fake.ph) })
    client.send('signed_out', {})
    await expect(client.disableSharing()).resolves.toBeUndefined()
    const failing = startAnalytics({
      key: 'k',
      storage,
      load: () => Promise.reject(new Error('x')),
    })
    failing.send('signed_out', {})
    await expect(failing.enableSharing()).resolves.toBeUndefined()
  })
})
