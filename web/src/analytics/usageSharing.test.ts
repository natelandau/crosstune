import { describe, expect, it } from 'vitest'
import { isSharingUsage, SHARE_USAGE_KEY, setSharingUsage } from './usageSharing'

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

describe('usage sharing', () => {
  it('defaults to on', () => {
    expect(isSharingUsage(memoryStorage())).toBe(true)
  })

  it('reads a stored off', () => {
    expect(isSharingUsage(memoryStorage({ [SHARE_USAGE_KEY]: 'false' }))).toBe(false)
  })

  it('a throwing storage reads as on', () => {
    expect(isSharingUsage(throwingStorage())).toBe(true)
  })

  it('stores the choice and survives a throwing write', () => {
    const storage = memoryStorage()
    setSharingUsage(false, storage)
    expect(isSharingUsage(storage)).toBe(false)
    setSharingUsage(true, storage)
    expect(isSharingUsage(storage)).toBe(true)
    expect(() => setSharingUsage(false, throwingStorage())).not.toThrow()
  })
})
