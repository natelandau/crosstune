import { afterEach, expect, it, vi } from 'vitest'
import { browserBackgroundUploads } from './backgroundSync'

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'serviceWorker')
})

it('reports background uploads unavailable once the browser refuses a sync', async () => {
  vi.stubGlobal(
    'ServiceWorkerRegistration',
    Object.assign(function () {}, { prototype: { sync: null } }),
  )
  const register = vi
    .fn()
    .mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'))
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { controller: {}, ready: Promise.resolve({ sync: { register } }) },
  })
  const background = browserBackgroundUploads()
  expect(background.available()).toBe(true)

  expect(await background.request()).toBe(false)

  expect(background.available()).toBe(false)
})

it('shares one registration between requests made while it is in flight', async () => {
  const register = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { controller: {}, ready: Promise.resolve({ sync: { register } }) },
  })
  const background = browserBackgroundUploads()

  expect(await Promise.all([background.request(), background.request()])).toEqual([true, true])
  expect(register).toHaveBeenCalledTimes(1)

  expect(await background.request()).toBe(true)
  expect(register).toHaveBeenCalledTimes(2)
})
