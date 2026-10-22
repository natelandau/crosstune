import { expect, it, vi } from 'vitest'
import { fakeMapKit } from '../test/fakeMapKit'
import {
  browserMapKitEnv,
  loadMapKit,
  MAPKIT_LIBRARIES,
  MAPKIT_SCRIPT_URL,
  type MapKit,
  type MapKitEnv,
} from './mapkit'

/** A fresh environment per test, since a loaded MapKit is remembered per environment. */
function setup(mapkit: MapKit | undefined | null = fakeMapKit().mapkit) {
  const loadScript = vi.fn<MapKitEnv['loadScript']>(async () => {})
  // The clock never fires unless a test says a step has stalled.
  const wait = vi.fn<MapKitEnv['wait']>(() => new Promise(() => {}))
  const env: MapKitEnv = { loadScript, global: () => mapkit ?? undefined, wait }
  return { env, loadScript, wait }
}

it('loads the script once however many callers ask', async () => {
  const { mapkit, seen } = fakeMapKit()
  const { env, loadScript } = setup(mapkit)
  const fetchToken = vi.fn(async () => 'jwt')

  const [a, b] = await Promise.all([loadMapKit(fetchToken, env), loadMapKit(fetchToken, env)])
  const c = await loadMapKit(fetchToken, env)

  expect(a).toBe(mapkit)
  expect(b).toBe(mapkit)
  expect(c).toBe(mapkit)
  expect(loadScript).toHaveBeenCalledTimes(1)
  expect(loadScript).toHaveBeenCalledWith(
    MAPKIT_SCRIPT_URL,
    MAPKIT_LIBRARIES,
    expect.any(AbortSignal),
  )
  expect(seen.inits).toBe(1)
  expect(fetchToken).toHaveBeenCalledTimes(1)
})

it('pins an exact MapKit JS 5 version and only the libraries it draws with', () => {
  expect(MAPKIT_SCRIPT_URL).toMatch(
    /^https:\/\/cdn\.apple-mapkit\.com\/mk\/5\.\d+\.\d+\/mapkit\.core\.js$/,
  )
  expect([...MAPKIT_LIBRARIES].sort()).toEqual(['annotations', 'map', 'overlays', 'services'])
})

it('resolves null, loading nothing, when the token route fails', async () => {
  const { env, loadScript } = setup()
  await expect(loadMapKit(async () => null, env)).resolves.toBeNull()
  await expect(
    loadMapKit(async () => {
      throw new Error('503')
    }, env),
  ).resolves.toBeNull()
  expect(loadScript).not.toHaveBeenCalled()
})

it('resolves null when the script fails, and tries again on the next ask', async () => {
  const { mapkit } = fakeMapKit()
  const { env, loadScript } = setup(mapkit)
  loadScript.mockRejectedValueOnce(new Error('blocked'))

  await expect(loadMapKit(async () => 'jwt', env)).resolves.toBeNull()
  await expect(loadMapKit(async () => 'jwt', env)).resolves.toBe(mapkit)
  expect(loadScript).toHaveBeenCalledTimes(2)
})

it('resolves null when the script ran but left no MapKit behind', async () => {
  const { env } = setup(null)
  await expect(loadMapKit(async () => 'jwt', env)).resolves.toBeNull()
})

it('hands MapKit the first token, then fetches a new one each time it asks again', async () => {
  const { mapkit, dispatch } = fakeMapKit()
  const init = vi.fn<MapKit['init']>(() =>
    queueMicrotask(() => dispatch('configuration-change', { status: 'Initialized' })),
  )
  mapkit.init = init
  const { env } = setup(mapkit)
  const tokens = ['first', 'second', 'third']
  const fetchToken = vi.fn(async () => tokens.shift() ?? null)
  await loadMapKit(fetchToken, env)

  const authorize = init.mock.calls[0]![0].authorizationCallback
  const done = vi.fn()
  authorize(done)
  await expect.poll(() => done.mock.calls).toEqual([['first']])
  authorize(done)
  await expect.poll(() => done.mock.calls).toEqual([['first'], ['second']])
  expect(fetchToken).toHaveBeenCalledTimes(2)
})

it('answers an empty token, which MapKit reports as an error, when a refresh fails', async () => {
  const { mapkit, dispatch } = fakeMapKit()
  const init = vi.fn<MapKit['init']>(() =>
    queueMicrotask(() => dispatch('configuration-change', { status: 'Initialized' })),
  )
  mapkit.init = init
  const { env } = setup(mapkit)
  const tokens: (string | null)[] = ['first', null]
  await loadMapKit(async () => tokens.shift() ?? null, env)

  const authorize = init.mock.calls[0]![0].authorizationCallback
  const done = vi.fn()
  authorize(done)
  authorize(done)
  await expect.poll(() => done.mock.calls).toEqual([['first'], ['']])
})

it('hands a refresh to the newest token source, not the first', async () => {
  const { mapkit, dispatch } = fakeMapKit()
  const init = vi.fn<MapKit['init']>(() =>
    queueMicrotask(() => dispatch('configuration-change', { status: 'Initialized' })),
  )
  mapkit.init = init
  const { env } = setup(mapkit)
  await loadMapKit(async () => 'first', env)
  await loadMapKit(async () => 'second user', env)

  const done = vi.fn()
  const authorize = init.mock.calls[0]![0].authorizationCallback
  authorize(done)
  authorize(done)
  await expect.poll(() => done.mock.calls).toEqual([['first'], ['second user']])
})

it('resolves null when MapKit refuses its token, and stays failed', async () => {
  const { mapkit, dispatch } = fakeMapKit({ initError: 'Unauthorized' })
  const { env, loadScript } = setup(mapkit)
  await expect(loadMapKit(async () => 'jwt', env)).resolves.toBeNull()
  dispatch('configuration-change', { status: 'Refreshed' })
  // MapKit cannot be initialized a second time, so nothing starts over.
  await expect(loadMapKit(async () => 'jwt', env)).resolves.toBeNull()
  expect(loadScript).toHaveBeenCalledTimes(1)
})

it('waits through a throttled configuration, then resolves MapKit once it configures', async () => {
  const { mapkit, seen, dispatch } = fakeMapKit({ initError: 'Too Many Requests' })
  const { env, loadScript } = setup(mapkit)
  const first = loadMapKit(async () => 'jwt', env)
  // The throttle answers in a microtask after `init`, long before a poll's next check.
  await expect.poll(() => seen.inits).toBe(1)
  dispatch('configuration-change', { status: 'Refreshed' })
  await expect(first).resolves.toBe(mapkit)
  expect(loadScript).toHaveBeenCalledTimes(1)
})

it('holds an ask made during a passing error until MapKit configures itself again', async () => {
  for (const status of ['Network Error', 'Timeout', 'Too Many Requests']) {
    const { mapkit, dispatch } = fakeMapKit()
    const { env } = setup(mapkit)
    await expect(loadMapKit(async () => 'jwt', env)).resolves.toBe(mapkit)
    dispatch('error', { status })
    const waiting = loadMapKit(async () => 'jwt', env)
    dispatch('configuration-change', { status: 'Refreshed' })
    await expect(waiting).resolves.toBe(mapkit)
  }
})

it('resolves an ask held through a passing error with null once MapKit refuses its token', async () => {
  const { mapkit, dispatch } = fakeMapKit()
  const { env } = setup(mapkit)
  await expect(loadMapKit(async () => 'jwt', env)).resolves.toBe(mapkit)
  dispatch('error', { status: 'Network Error' })
  const waiting = loadMapKit(async () => 'jwt', env)
  dispatch('error', { status: 'Unauthorized' })
  await expect(waiting).resolves.toBeNull()
})

it('stays failed once MapKit refuses a refreshed token', async () => {
  const { mapkit, dispatch } = fakeMapKit()
  const { env } = setup(mapkit)
  await expect(loadMapKit(async () => 'jwt', env)).resolves.toBe(mapkit)
  dispatch('error', { status: 'Unauthorized' })
  dispatch('configuration-change', { status: 'Refreshed' })
  await expect(loadMapKit(async () => 'jwt', env)).resolves.toBeNull()
})

it('resolves null when the script left a MapKit without its libraries, and tries again', async () => {
  const { mapkit } = fakeMapKit()
  const partial = { ...mapkit, Map: undefined } as unknown as MapKit
  let current: MapKit = partial
  const { env, loadScript } = setup(null)
  env.global = () => current

  await expect(loadMapKit(async () => 'jwt', env)).resolves.toBeNull()
  current = mapkit
  await expect(loadMapKit(async () => 'jwt', env)).resolves.toBe(mapkit)
  expect(loadScript).toHaveBeenCalledTimes(2)
})

it('resolves null when a getter for a missing library throws', async () => {
  const { mapkit } = fakeMapKit()
  const throwing = Object.create(mapkit, {
    PointsOfInterestSearch: {
      get() {
        throw new Error('library not loaded')
      },
    },
  }) as MapKit
  const { env } = setup(throwing)
  await expect(loadMapKit(async () => 'jwt', env)).resolves.toBeNull()
})

it('gives up on a script that never calls back, and tries again on the next ask', async () => {
  const { mapkit } = fakeMapKit()
  const { env, loadScript, wait } = setup(mapkit)
  loadScript.mockImplementationOnce(() => new Promise(() => {}))
  wait.mockImplementationOnce(async () => {})

  await expect(loadMapKit(async () => 'jwt', env)).resolves.toBeNull()
  // The stalled script is told to stop, so a late load cannot answer a later attempt.
  expect(loadScript.mock.calls[0]![2]?.aborted).toBe(true)
  await expect(loadMapKit(async () => 'jwt', env)).resolves.toBe(mapkit)
  expect(loadScript).toHaveBeenCalledTimes(2)
})

it('gives up when MapKit never answers its configuration, and stops listening for it', async () => {
  const { mapkit, dispatch, listenerCount } = fakeMapKit()
  mapkit.init = () => {}
  const { env, wait } = setup(mapkit)
  // The first wait guards the script, which answers at once; the second guards configuration.
  wait.mockImplementationOnce(() => new Promise(() => {}))
  wait.mockImplementationOnce(async () => {})

  await expect(loadMapKit(async () => 'jwt', env)).resolves.toBeNull()
  // Only the watch that brings MapKit back once it configures itself still listens.
  expect(listenerCount('configuration-change')).toBe(1)
  expect(listenerCount('error')).toBe(1)
  dispatch('configuration-change', { status: 'Initialized' })
  await expect(loadMapKit(async () => 'jwt', env)).resolves.toBe(mapkit)
})

it('removes a stopped script and its callback, so a late load answers nothing', async () => {
  const before = Object.keys(window)
  const stop = new AbortController()
  const loading = browserMapKitEnv.loadScript('data:text/javascript,', ['map'], stop.signal)
  const added = () => Object.keys(window).filter((key) => !before.includes(key))
  await expect.poll(() => added().length).toBe(1)
  expect(document.querySelectorAll('script[data-callback]')).toHaveLength(1)

  stop.abort()

  await expect(loading).rejects.toThrow()
  expect(added()).toEqual([])
  expect(document.querySelectorAll('script[data-callback]')).toHaveLength(0)
})

it('names each script load its own callback', async () => {
  const first = new AbortController()
  const second = new AbortController()
  const loads = [
    browserMapKitEnv.loadScript('data:text/javascript,', ['map'], first.signal),
    browserMapKitEnv.loadScript('data:text/javascript,', ['map'], second.signal),
  ]
  const names = () =>
    [...document.querySelectorAll<HTMLScriptElement>('script[data-callback]')].map(
      (script) => script.dataset.callback,
    )
  await expect.poll(() => names().length).toBe(2)
  expect(new Set(names()).size).toBe(2)
  first.abort()
  second.abort()
  await Promise.allSettled(loads)
})
