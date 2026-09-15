import { describe, expect, it } from 'vitest'
import { FakeLockManager } from '../test/fakeLocks'
import { acquireCaptureLock, captureLockName, heldCaptureIds } from './captureLock'

describe('captureLockName', () => {
  it('namespaces a recording id under capture:', () => {
    expect(captureLockName('abc')).toBe('capture:abc')
  })
})

describe('acquireCaptureLock', () => {
  it('holds the lock until released', async () => {
    const locks = new FakeLockManager()
    const release = await acquireCaptureLock('r1', locks)
    expect(await heldCaptureIds(locks)).toEqual(new Set(['r1']))
    release()
    // The lock manager only drops the entry once the granted callback's promise settles.
    await Promise.resolve()
    await Promise.resolve()
    expect(await heldCaptureIds(locks)).toEqual(new Set())
  })

  it('resolves a no-op release when there is no lock manager', async () => {
    const release = await acquireCaptureLock('r1', undefined)
    expect(() => release()).not.toThrow()
  })

  it('rejects when the lock manager refuses the request before granting it', async () => {
    const error = new Error('SecurityError')
    const locks: LockManager = {
      request: () => Promise.reject(error),
      query: () => Promise.resolve({ held: [], pending: [] }),
    }
    await expect(acquireCaptureLock('r1', locks)).rejects.toBe(error)
  })

  it('does not resolve a second acquire for the same id until the first releases', async () => {
    const locks = new FakeLockManager()
    const release = await acquireCaptureLock('r1', locks)
    let secondResolved = false
    const second = acquireCaptureLock('r1', locks).then((releaseSecond) => {
      secondResolved = true
      return releaseSecond
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(secondResolved).toBe(false)
    release()
    const releaseSecond = await second
    expect(secondResolved).toBe(true)
    releaseSecond()
  })
})

describe('heldCaptureIds', () => {
  it('returns only the capture: locks, stripped of their prefix', async () => {
    const locks = new FakeLockManager()
    await acquireCaptureLock('r1', locks)
    void locks.request('other:thing', () => new Promise<void>(() => {}))
    expect(await heldCaptureIds(locks)).toEqual(new Set(['r1']))
  })

  it('returns null when there is no lock manager', async () => {
    expect(await heldCaptureIds(undefined)).toBeNull()
  })
})
