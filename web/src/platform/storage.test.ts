import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { createStoredValue, onOtherTabWrite, readStored, writeStored } from './storage'

const KEY = 'crosstune.test.value'

function blockStorage(): void {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('blocked', 'SecurityError')
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('blocked', 'SecurityError')
  })
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new DOMException('blocked', 'SecurityError')
  })
}

function otherTabWrote(key: string | null): void {
  window.dispatchEvent(new StorageEvent('storage', { key }))
}

const numberStore = () =>
  createStoredValue<number>({
    key: KEY,
    parse: (raw) => (raw === null ? 0 : Number(raw)),
    serialize: String,
  })

afterEach(() => {
  localStorage.clear()
})

describe('readStored and writeStored', () => {
  it('round-trips a value in local storage', () => {
    writeStored(KEY, 'a')
    expect(readStored(KEY)).toBe('a')
    expect(localStorage.getItem(KEY)).toBe('a')
  })

  it('uses session storage when asked', () => {
    writeStored(KEY, 'b', 'session')
    expect(sessionStorage.getItem(KEY)).toBe('b')
    expect(readStored(KEY, 'session')).toBe('b')
    expect(readStored(KEY)).toBeNull()
  })

  it('removes the key when written null', () => {
    writeStored(KEY, 'a')
    writeStored(KEY, null)
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('reads null and writes nothing when storage is blocked', () => {
    blockStorage()
    expect(readStored(KEY)).toBeNull()
    expect(() => writeStored(KEY, 'a')).not.toThrow()
    expect(() => writeStored(KEY, null)).not.toThrow()
  })
})

describe('createStoredValue', () => {
  it('starts from the stored value, parsed', () => {
    localStorage.setItem(KEY, '7')
    expect(numberStore().get()).toBe(7)
  })

  it('persists a set value and tells subscribers', () => {
    const store = numberStore()
    const listener = vi.fn()
    onTestFinished(store.subscribe(listener))

    store.set(3)

    expect(store.get()).toBe(3)
    expect(localStorage.getItem(KEY)).toBe('3')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('reads storage once, so memory wins afterwards', () => {
    const store = numberStore()
    expect(store.get()).toBe(0)
    localStorage.setItem(KEY, '9')
    expect(store.get()).toBe(0)
  })

  it('keeps a value set while storage is blocked', () => {
    blockStorage()
    const store = numberStore()
    store.set(5)
    expect(store.get()).toBe(5)
  })

  it('stops telling a subscriber once it unsubscribes', () => {
    const store = numberStore()
    const listener = vi.fn()
    store.subscribe(listener)()
    store.set(1)
    expect(listener).not.toHaveBeenCalled()
  })

  it('re-reads storage and tells subscribers on reload', () => {
    const store = numberStore()
    const listener = vi.fn()
    onTestFinished(store.subscribe(listener))
    store.get()
    localStorage.setItem(KEY, '4')

    store.reload()

    expect(store.get()).toBe(4)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('onOtherTabWrite', () => {
  it('runs for a write to one of its keys, or a clear', () => {
    const onWrite = vi.fn()
    onTestFinished(onOtherTabWrite([KEY], onWrite))

    otherTabWrote(KEY)
    otherTabWrote(null)

    expect(onWrite).toHaveBeenCalledTimes(2)
  })

  it('ignores writes to other keys', () => {
    const onWrite = vi.fn()
    onTestFinished(onOtherTabWrite([KEY], onWrite))

    otherTabWrote('crosstune.test.other')

    expect(onWrite).not.toHaveBeenCalled()
  })

  it('stops once torn down', () => {
    const onWrite = vi.fn()
    onOtherTabWrite([KEY], onWrite)()

    otherTabWrote(KEY)

    expect(onWrite).not.toHaveBeenCalled()
  })
})
