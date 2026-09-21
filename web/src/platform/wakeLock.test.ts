import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { holdScreenAwake, useWakeLock } from './wakeLock'

interface FakeSentinel {
  released: boolean
  release: () => Promise<void>
  addEventListener: (type: string, listener: () => void) => void
  /** Simulates the browser auto-releasing a sentinel, for example when a tab is hidden. */
  fireRelease: () => void
}

function makeSentinel(): FakeSentinel {
  let releaseListener: (() => void) | undefined
  const sentinel: FakeSentinel = {
    released: false,
    release: async () => {
      sentinel.released = true
    },
    addEventListener: (_type, listener) => {
      releaseListener = listener
    },
    fireRelease: () => releaseListener?.(),
  }
  return sentinel
}

function fakeWakeLock(request?: () => Promise<FakeSentinel>) {
  const sentinels: FakeSentinel[] = []
  const make = async (): Promise<FakeSentinel> => {
    const sentinel = makeSentinel()
    sentinels.push(sentinel)
    return sentinel
  }
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: { request: request ?? make },
  })
  return sentinels
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

/**
 * A macrotask boundary drains the microtask queue, so a promise chain (then/catch/finally) is
 * guaranteed to have settled by the time this resolves, unlike a resolved sentinel count alone.
 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'wakeLock')
  Reflect.deleteProperty(document, 'visibilityState')
  vi.restoreAllMocks()
})

describe('holdScreenAwake', () => {
  it('takes a lock and releases it', async () => {
    const sentinels = fakeWakeLock()
    const release = holdScreenAwake()
    try {
      await vi.waitFor(() => expect(sentinels).toHaveLength(1))
    } finally {
      release()
    }
    await vi.waitFor(() => expect(sentinels[0]!.released).toBe(true))
  })

  it('does nothing where the API is missing', () => {
    Reflect.deleteProperty(navigator, 'wakeLock')
    expect(() => holdScreenAwake()()).not.toThrow()
  })

  it('swallows a refused request without wedging a later attempt', async () => {
    const granted: FakeSentinel[] = []
    let refused = true
    fakeWakeLock(async () => {
      if (refused) {
        refused = false
        throw new Error('NotAllowedError')
      }
      const sentinel = makeSentinel()
      granted.push(sentinel)
      return sentinel
    })
    const release = holdScreenAwake()
    try {
      await flush()
      expect(granted).toHaveLength(0)

      setVisibility('hidden')
      setVisibility('visible')
      await vi.waitFor(() => expect(granted).toHaveLength(1))
    } finally {
      release()
    }
  })

  it('does not send a second request while the first is still in flight', async () => {
    let requests = 0
    let resolveFirst!: (sentinel: FakeSentinel) => void
    fakeWakeLock(() => {
      requests += 1
      if (requests === 1) {
        return new Promise<FakeSentinel>((resolve) => {
          resolveFirst = resolve
        })
      }
      return Promise.resolve(makeSentinel())
    })

    const release = holdScreenAwake()
    try {
      expect(requests).toBe(1)

      // The tab hides and shows again before the first request has resolved: with no in-flight
      // guard, sentinel is still null at this point and a second request would fire here.
      setVisibility('hidden')
      setVisibility('visible')
      expect(requests).toBe(1)

      resolveFirst(makeSentinel())
      await flush()
      expect(requests).toBe(1)
    } finally {
      release()
    }
  })

  it('re-takes a lock missed by a visibility change while a request was in flight', async () => {
    let rejectFirst!: (error: Error) => void
    let requests = 0
    const secondSentinel = makeSentinel()
    fakeWakeLock(() => {
      requests += 1
      if (requests === 1) {
        return new Promise<FakeSentinel>((_resolve, reject) => {
          rejectFirst = reject
        })
      }
      return Promise.resolve(secondSentinel)
    })

    const release = holdScreenAwake()
    try {
      expect(requests).toBe(1)

      // A browser rejects a lock whose document went hidden during acquisition: the visible
      // event that arrives before that rejection must not be dropped once it settles.
      setVisibility('hidden')
      setVisibility('visible')

      rejectFirst(new Error('hidden during acquisition'))
      await flush()

      expect(requests).toBe(2)
    } finally {
      release()
    }
    await flush()
    expect(secondSentinel.released).toBe(true)
  })

  it('recovers from a synchronous throw out of request()', async () => {
    let calls = 0
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: () => {
          calls += 1
          if (calls === 1) throw new Error('NotAllowedError')
          return Promise.resolve(makeSentinel())
        },
      },
    })

    const release = holdScreenAwake()
    try {
      await flush()
      expect(calls).toBe(1)

      setVisibility('hidden')
      setVisibility('visible')
      await flush()

      expect(calls).toBe(2)
    } finally {
      release()
    }
  })

  it('treats an already-released granted sentinel as a failed request', async () => {
    let calls = 0
    const dead = makeSentinel()
    void dead.release()
    fakeWakeLock(async () => {
      calls += 1
      return calls === 1 ? dead : makeSentinel()
    })

    const release = holdScreenAwake()
    try {
      await flush()
      expect(calls).toBe(1)

      // A dead sentinel must not be mistaken for a currently held lock.
      setVisibility('hidden')
      setVisibility('visible')
      await flush()

      expect(calls).toBe(2)
    } finally {
      release()
    }
  })

  it('re-takes the lock after the tab hides and shows again', async () => {
    const sentinels = fakeWakeLock()
    const release = holdScreenAwake()
    try {
      await vi.waitFor(() => expect(sentinels).toHaveLength(1))
      await flush()

      setVisibility('hidden')
      sentinels[0]!.fireRelease()
      setVisibility('visible')

      await vi.waitFor(() => expect(sentinels).toHaveLength(2))
    } finally {
      release()
    }
  })

  it('does not overwrite a currently held lock when an earlier one auto-releases late', async () => {
    const sentinels = fakeWakeLock()
    const release = holdScreenAwake()
    try {
      await vi.waitFor(() => expect(sentinels).toHaveLength(1))
      await flush()

      // Reach a second, currently held sentinel the same way a real hide-then-show does.
      setVisibility('hidden')
      sentinels[0]!.fireRelease()
      setVisibility('visible')
      await vi.waitFor(() => expect(sentinels).toHaveLength(2))
      await flush()

      // The first sentinel fires its release again, late, after it has already been superseded:
      // it must not be mistaken for the one currently held.
      sentinels[0]!.fireRelease()
      setVisibility('hidden')
      setVisibility('visible')

      // Still holding sentinel 1, so no third request is made.
      expect(sentinels).toHaveLength(2)
    } finally {
      release()
    }
  })

  it('requests no further lock once the caller has released', async () => {
    const sentinels = fakeWakeLock()
    const release = holdScreenAwake()
    try {
      await vi.waitFor(() => expect(sentinels).toHaveLength(1))
    } finally {
      release()
    }
    setVisibility('hidden')
    setVisibility('visible')

    expect(sentinels).toHaveLength(1)
  })

  it('removes the visibilitychange listener on release', () => {
    const addSpy = vi.spyOn(document, 'addEventListener')
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    fakeWakeLock()
    const release = holdScreenAwake()
    release()

    const [, listener] = addSpy.mock.calls.find(([type]) => type === 'visibilitychange')!
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', listener)
  })

  it('releases a lock granted after the caller had already released', async () => {
    let resolveRequest!: (sentinel: FakeSentinel) => void
    fakeWakeLock(
      () =>
        new Promise<FakeSentinel>((resolve) => {
          resolveRequest = resolve
        }),
    )
    const release = holdScreenAwake()
    release()

    const sentinel = makeSentinel()
    resolveRequest(sentinel)

    await vi.waitFor(() => expect(sentinel.released).toBe(true))
  })
})

describe('useWakeLock', () => {
  it('holds the lock while active and releases it once inactive', async () => {
    const sentinels = fakeWakeLock()
    const { rerender } = renderHook(({ active }) => useWakeLock(active), {
      initialProps: { active: true },
    })
    await vi.waitFor(() => expect(sentinels).toHaveLength(1))

    rerender({ active: false })
    await vi.waitFor(() => expect(sentinels[0]!.released).toBe(true))
  })
})
