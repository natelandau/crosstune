import { describe, expect, it, vi } from 'vitest'
import { holdWakeLock } from './wakeLock'

function fakeSentinel() {
  const listeners: Record<string, () => void> = {}
  return {
    released: false,
    release: vi.fn(async () => {}),
    addEventListener: vi.fn((event: string, cb: () => void) => {
      listeners[event] = cb
    }),
    fireRelease: () => listeners.release?.(),
  }
}

function fakeNav() {
  const sentinel = fakeSentinel()
  const request = vi.fn(async () => sentinel)
  return { nav: { wakeLock: { request } } as unknown as Navigator, request, sentinel }
}

describe('holdWakeLock', () => {
  it('requests on hold, re-requests when visible again, and releases', async () => {
    const { nav, request, sentinel } = fakeNav()
    const doc = document
    const release = holdWakeLock({ doc, nav })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    sentinel.released = true
    doc.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    release()
    expect(sentinel.release).toHaveBeenCalled()
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('is a no-op without the API', () => {
    const release = holdWakeLock({ doc: document, nav: {} as Navigator })
    expect(() => release()).not.toThrow()
  })

  it('releases a sentinel that resolves after release() was already called', async () => {
    const sentinel = fakeSentinel()
    let resolveRequest: (value: ReturnType<typeof fakeSentinel>) => void = () => {}
    const request = vi.fn(
      () =>
        new Promise<ReturnType<typeof fakeSentinel>>((resolve) => {
          resolveRequest = resolve
        }),
    )
    const nav = { wakeLock: { request } } as unknown as Navigator
    const release = holdWakeLock({ doc: document, nav })
    release()
    resolveRequest(sentinel)
    await vi.waitFor(() => expect(sentinel.release).toHaveBeenCalled())
  })

  it('re-requests when the sentinel releases itself while the page is visible', async () => {
    const { nav, request, sentinel } = fakeNav()
    const release = holdWakeLock({ doc: document, nav })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    sentinel.released = true
    sentinel.fireRelease()
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    release()
  })
})
