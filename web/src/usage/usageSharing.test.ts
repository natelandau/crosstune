import { describe, expect, it, vi } from 'vitest'
import {
  resolveSharingDefault,
  SHARE_USAGE_KEY,
  setSharingUsage,
  storedSharingChoice,
} from './usageSharing'

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial))
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  }
}

const throwingStorage = (): Storage => {
  const fail = () => {
    throw new Error('blocked')
  }
  return { ...memoryStorage(), getItem: fail, setItem: fail }
}

describe('stored sharing choice', () => {
  it('is null when nothing is stored', () => {
    expect(storedSharingChoice(memoryStorage())).toBeNull()
  })

  it('reads a stored choice either way', () => {
    expect(storedSharingChoice(memoryStorage({ [SHARE_USAGE_KEY]: 'false' }))).toBe(false)
    expect(storedSharingChoice(memoryStorage({ [SHARE_USAGE_KEY]: 'true' }))).toBe(true)
  })

  it('is null for a throwing storage', () => {
    expect(storedSharingChoice(throwingStorage())).toBeNull()
  })

  it('stores the choice and survives a throwing write', () => {
    const storage = memoryStorage()
    setSharingUsage(false, storage)
    expect(storedSharingChoice(storage)).toBe(false)
    setSharingUsage(true, storage)
    expect(storedSharingChoice(storage)).toBe(true)
    expect(() => setSharingUsage(false, throwingStorage())).not.toThrow()
  })
})

describe('resolveSharingDefault', () => {
  const region = (consent_required: boolean | null) => vi.fn(async () => ({ consent_required }))

  it('turns on and stores where consent is not required', async () => {
    const storage = memoryStorage()
    await expect(resolveSharingDefault(region(false), storage)).resolves.toBe(true)
    expect(storage.getItem(SHARE_USAGE_KEY)).toBe('true')
  })

  it('stays off and stores off where consent is required', async () => {
    const storage = memoryStorage()
    await expect(resolveSharingDefault(region(true), storage)).resolves.toBe(false)
    expect(storage.getItem(SHARE_USAGE_KEY)).toBe('false')
  })

  it('stores nothing and stays off when the region is unknown', async () => {
    const storage = memoryStorage()
    await expect(resolveSharingDefault(region(null), storage)).resolves.toBe(false)
    expect(storage.getItem(SHARE_USAGE_KEY)).toBeNull()
  })

  it('stores nothing and stays off when the request rejects or throws', async () => {
    const storage = memoryStorage()
    const rejecting = vi.fn(() => Promise.reject(new Error('offline')))
    await expect(resolveSharingDefault(rejecting, storage)).resolves.toBe(false)
    const throwing = vi.fn(() => {
      throw new Error('sync')
    })
    await expect(resolveSharingDefault(throwing, storage)).resolves.toBe(false)
    expect(storage.getItem(SHARE_USAGE_KEY)).toBeNull()
  })

  it('never overwrites a stored off, even where consent is not required', async () => {
    const storage = memoryStorage({ [SHARE_USAGE_KEY]: 'false' })
    const ask = region(false)
    await expect(resolveSharingDefault(ask, storage)).resolves.toBe(false)
    expect(ask).not.toHaveBeenCalled()
    expect(storage.getItem(SHARE_USAGE_KEY)).toBe('false')
  })

  it('keeps a stored on without asking', async () => {
    const storage = memoryStorage({ [SHARE_USAGE_KEY]: 'true' })
    const ask = region(true)
    await expect(resolveSharingDefault(ask, storage)).resolves.toBe(true)
    expect(ask).not.toHaveBeenCalled()
  })

  it('lets a choice made during the request win', async () => {
    const storage = memoryStorage()
    const ask = vi.fn(async () => {
      setSharingUsage(false, storage)
      return { consent_required: false }
    })
    await expect(resolveSharingDefault(ask, storage)).resolves.toBe(false)
    expect(storage.getItem(SHARE_USAGE_KEY)).toBe('false')
  })
})
