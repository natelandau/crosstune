import { act, renderHook } from '@testing-library/react'
import { Component, type ReactNode } from 'react'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { DbContext } from '../db/DbProvider'
import { openTestDb } from '../test/db'
import { entitlementRow } from '../test/rows'
import { FixedNow } from '../ui/useNow'
import { dueNotice } from './plan'
import { useEntitlement, usePlan, usePlanCheckOrUnknown, usePlanOrUnknown } from './usePlan'

class Boundary extends Component<
  { onError: (error: unknown) => void; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override componentDidCatch(error: unknown) {
    this.props.onError(error)
  }
  override render() {
    return this.state.failed ? null : this.props.children
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('usePlan', () => {
  it('turns from premium to free when the clock passes the expiry, with no row change', async () => {
    const db = openTestDb()
    const now = new Date('2026-10-10T12:00:00.000Z')
    await db.entitlements.put(
      entitlementRow({
        premium_source: 'trial',
        premium_expires_at: '2026-10-10T12:00:10.000Z',
        trial_ends_at: '2026-10-10T12:00:10.000Z',
      }),
    )
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(now)
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DbContext.Provider value={db}>{children}</DbContext.Provider>
    )
    const { result } = renderHook(() => usePlan(), { wrapper })
    await vi.waitFor(() => expect(result.current.kind).toBe('premium'))

    await vi.advanceTimersByTimeAsync(10_000)
    await vi.waitFor(() => expect(result.current.kind).toBe('free'))
    expect(result.current.scansOnly).toBe(true)
  })

  describe('after the precise timer is missed', () => {
    async function setup() {
      const db = openTestDb()
      await db.entitlements.put(
        entitlementRow({
          premium_source: 'trial',
          premium_expires_at: '2026-10-10T12:30:00.000Z',
          trial_ends_at: '2026-10-10T12:30:00.000Z',
        }),
      )
      vi.useFakeTimers({
        toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
      })
      vi.setSystemTime(new Date('2026-10-10T12:00:00.000Z'))
      const wrapper = ({ children }: { children: ReactNode }) => (
        <DbContext.Provider value={db}>{children}</DbContext.Provider>
      )
      const hook = renderHook(() => usePlan(), { wrapper })
      await vi.waitFor(() => expect(hook.result.current.kind).toBe('premium'))
      // A sleeping device's clock jumps while its timers stay put.
      vi.setSystemTime(new Date('2026-10-10T13:00:00.000Z'))
      return hook
    }

    it('turns free when the page becomes visible', async () => {
      const { result } = await setup()
      expect(result.current.kind).toBe('premium')
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await vi.waitFor(() => expect(result.current.kind).toBe('free'))
    })

    it('turns free when the window gains focus', async () => {
      const { result } = await setup()
      act(() => {
        window.dispatchEvent(new Event('focus'))
      })
      await vi.waitFor(() => expect(result.current.kind).toBe('free'))
    })

    it('turns free on the slow recheck', async () => {
      const { result } = await setup()
      // The precise timer is half an hour away, so only the slow interval fires.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })
      await vi.waitFor(() => expect(result.current.kind).toBe('free'))
    })

    it('does not render again when a check finds nothing changed', async () => {
      const db = openTestDb()
      await db.entitlements.put(entitlementRow({ premium_source: 'comp' }))
      vi.useFakeTimers({
        toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
      })
      vi.setSystemTime(new Date('2026-10-10T12:00:00.000Z'))
      const wrapper = ({ children }: { children: ReactNode }) => (
        <DbContext.Provider value={db}>{children}</DbContext.Provider>
      )
      let renders = 0
      const { result } = renderHook(
        () => {
          renders++
          return usePlan()
        },
        { wrapper },
      )
      await vi.waitFor(() => expect(result.current.kind).toBe('premium'))
      await act(async () => {})
      const settled = renders
      act(() => {
        window.dispatchEvent(new Event('focus'))
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120_000)
      })
      expect(renders).toBe(settled)
    })

    it('keeps the same plan object while nothing it holds changes', async () => {
      const { result } = await setup()
      const before = result.current
      act(() => {
        window.dispatchEvent(new Event('focus'))
      })
      await vi.waitFor(() => expect(result.current.kind).toBe('free'))
      const free = result.current
      act(() => {
        window.dispatchEvent(new Event('focus'))
      })
      expect(result.current).toBe(free)
      expect(free).not.toBe(before)
    })
  })

  it('runs one clock for every reader and stops it when the last one unmounts', async () => {
    const db = openTestDb()
    await db.entitlements.put(
      entitlementRow({
        premium_source: 'trial',
        premium_expires_at: '2026-10-10T12:00:10.000Z',
        trial_ends_at: '2026-10-10T12:00:10.000Z',
      }),
    )
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    })
    vi.setSystemTime(new Date('2026-10-10T12:00:00.000Z'))
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const addListener = vi.spyOn(window, 'addEventListener')
    const removeListener = vi.spyOn(window, 'removeEventListener')
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DbContext.Provider value={db}>{children}</DbContext.Provider>
    )
    const first = renderHook(() => usePlan(), { wrapper })
    const second = renderHook(() => usePlan(), { wrapper })
    await vi.waitFor(() => {
      expect(first.result.current.kind).toBe('premium')
      expect(second.result.current.kind).toBe('premium')
    })
    expect(setIntervalSpy).toHaveBeenCalledTimes(1)
    expect(addListener.mock.calls.filter(([type]) => type === 'focus')).toHaveLength(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(first.result.current.kind).toBe('free')
    expect(second.result.current.kind).toBe('free')

    first.unmount()
    second.unmount()
    await act(async () => {})
    expect(removeListener.mock.calls.filter(([type]) => type === 'focus')).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('renews the check at the trial reminder while the plan stays the same object', async () => {
    const db = openTestDb()
    const trialEnd = '2026-10-13T12:01:00.000Z'
    await db.entitlements.put(
      entitlementRow({
        premium_source: 'trial',
        premium_expires_at: trialEnd,
        trial_ends_at: trialEnd,
      }),
    )
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    })
    // Three days and a minute before the trial ends.
    vi.setSystemTime(new Date('2026-10-10T12:00:00.000Z'))
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DbContext.Provider value={db}>{children}</DbContext.Provider>
    )
    const { result } = renderHook(() => ({ plan: usePlan(), check: usePlanCheckOrUnknown() }), {
      wrapper,
    })
    await vi.waitFor(() => expect(result.current.plan.kind).toBe('premium'))
    const plan = result.current.plan
    const before = result.current.check
    expect(dueNotice(before.row, before.now, false)).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(result.current.check).toBe(before)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    const after = result.current.check
    expect(after).not.toBe(before)
    expect(dueNotice(after.row, after.now, false)).toBe('trial_reminder')
    expect(result.current.plan).toBe(plan)
  })

  it.each([
    ['the shared clock', null],
    ['a fixed now', Date.parse('2026-10-10T12:00:00.000Z')],
  ])('throws a failed entitlements read to the error boundary, on %s', async (_label, fixed) => {
    const db = openTestDb()
    const failure = new Error('read failed')
    vi.spyOn(db.entitlements, 'filter').mockReturnValue({
      first: () => Promise.reject(failure),
    } as unknown as ReturnType<typeof db.entitlements.filter>)
    const onError = vi.fn()
    // React logs every error a boundary catches.
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    onTestFinished(() => log.mockRestore())

    renderHook(() => usePlan(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <FixedNow.Provider value={fixed}>
          <DbContext.Provider value={db}>
            <Boundary onError={onError}>{children}</Boundary>
          </DbContext.Provider>
        </FixedNow.Provider>
      ),
    })

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure))
  })

  it('judges a row another reader already holds in its first render, before the clock runs', async () => {
    const db = openTestDb()
    await db.entitlements.put(entitlementRow({ premium_source: 'comp' }))
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DbContext.Provider value={db}>{children}</DbContext.Provider>
    )
    const holder = renderHook(() => useEntitlement(), { wrapper })
    onTestFinished(() => holder.unmount())
    await vi.waitFor(() => expect(holder.result.current).toBeTruthy())

    const kinds: string[] = []
    const reader = renderHook(
      () => {
        const kind = usePlan().kind
        kinds.push(kind)
        return kind
      },
      { wrapper },
    )
    onTestFinished(() => reader.unmount())
    expect(kinds[0]).toBe('premium')
  })

  it('throws a failed read another reader already holds in its first render', async () => {
    const db = openTestDb()
    await db.entitlements.put(entitlementRow())
    vi.spyOn(db.entitlements, 'filter').mockReturnValue({
      first: () => Promise.reject(new Error('read failed')),
    } as unknown as ReturnType<typeof db.entitlements.filter>)
    const unsubscribe = useEntitlement.sharedFor(db).subscribe(() => {})
    onTestFinished(unsubscribe)
    await vi.waitFor(() => expect(useEntitlement.sharedFor(db).get().failure).toBeDefined())

    const kinds: string[] = []
    const onError = vi.fn()
    const reader = renderHook(
      () => {
        kinds.push(usePlan().kind)
      },
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <DbContext.Provider value={db}>
            <Boundary onError={onError}>{children}</Boundary>
          </DbContext.Provider>
        ),
      },
    )
    onTestFinished(() => reader.unmount())
    expect(onError).toHaveBeenCalled()
    expect(kinds).toEqual([])
  })

  it('reads a failed entitlements read as unknown from usePlanOrUnknown, throwing nothing', async () => {
    const db = openTestDb()
    await db.entitlements.put(entitlementRow())
    vi.spyOn(db.entitlements, 'filter').mockReturnValue({
      first: () => Promise.reject(new Error('read failed')),
    } as unknown as ReturnType<typeof db.entitlements.filter>)
    const onError = vi.fn()

    const { result } = renderHook(() => usePlanOrUnknown(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <DbContext.Provider value={db}>
          <Boundary onError={onError}>{children}</Boundary>
        </DbContext.Provider>
      ),
    })

    await vi.waitFor(() => expect(useEntitlement.sharedFor(db).get().failure).toBeDefined())
    expect(result.current.kind).toBe('unknown')
    expect(onError).not.toHaveBeenCalled()
  })

  it('flips at an instant past the largest timer delay without the slow recheck', async () => {
    const db = openTestDb()
    await db.entitlements.put(
      entitlementRow({
        premium_source: 'stripe',
        premium_expires_at: '2026-11-09T12:00:00.000Z',
      }),
    )
    // The interval stays real, so only the precise timer can reach the instant.
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-10-10T12:00:00.000Z'))
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DbContext.Provider value={db}>{children}</DbContext.Provider>
    )
    const { result } = renderHook(() => usePlan(), { wrapper })
    await vi.waitFor(() => expect(result.current.kind).toBe('premium'))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(Date.parse('2026-11-09T12:00:00.000Z') - Date.now() - 1)
    })
    expect(result.current.kind).toBe('premium')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(result.current.kind).toBe('free')
  })
})
