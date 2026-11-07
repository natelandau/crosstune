import { act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { page } from 'vitest/browser'
import { expect, it, vi } from 'vitest'
import { MapKitContext } from '../platform/useMapKit'
import { fakeMapKit, type FakeMapKitOptions } from '../test/fakeMapKit'
import { renderWithProviders } from '../test/render'
import { LocationMap, MAP_NEEDS_CONNECTION, MAP_UNAVAILABLE } from './LocationMap'

function setup(
  point: { accuracyM: number | null },
  options: FakeMapKitOptions = {},
  scheme: 'light' | 'dark' = 'light',
) {
  const { mapkit, seen, dispatch } = fakeMapKit(options)
  const load = vi.fn(async () => mapkit)
  const wrap = (children: ReactNode) => (
    <MapKitContext.Provider value={load}>{children}</MapKitContext.Provider>
  )
  const view = renderWithProviders(wrap(<LocationMap lat={36.66} lon={-80.92} {...point} />), {
    scheme,
  })
  return { ...view, seen, load, wrap, dispatch }
}

it('pins a precise point', async () => {
  const { seen } = setup({ accuracyM: 20 })
  await expect.poll(() => seen.annotations.length).toBe(1)
  expect(seen.overlays).toEqual([])
})

it('pins a point that has no accuracy, as a file location has', async () => {
  const { seen } = setup({ accuracyM: null })
  await expect.poll(() => seen.annotations.length).toBe(1)
  expect(seen.overlays).toEqual([])
})

it('pins a fix of exactly 50 m', async () => {
  const { seen } = setup({ accuracyM: 50 })
  await expect.poll(() => seen.annotations.length).toBe(1)
})

it('shows a circle as wide as the accuracy for a loose fix', async () => {
  const { seen } = setup({ accuracyM: 80 })
  await expect.poll(() => seen.overlays.length).toBe(1)
  expect(seen.overlays[0]!.radius).toBe(80)
  expect(seen.overlays[0]).toMatchObject({ center: { latitude: 36.66, longitude: -80.92 } })
  expect(seen.annotations).toEqual([])
})

it('holds the map still and in the app scheme', async () => {
  const { seen } = setup({ accuracyM: 20 }, {}, 'dark')
  await expect.poll(() => seen.maps.length).toBe(1)
  expect(seen.maps[0]!.options).toMatchObject({
    isScrollEnabled: false,
    isZoomEnabled: false,
    isRotationEnabled: false,
    colorScheme: 'dark',
  })
})

it('spans at least 400 m, and three times a loose fix', async () => {
  const tight = setup({ accuracyM: 20 })
  await expect.poll(() => tight.seen.maps.length).toBe(1)
  const loose = setup({ accuracyM: 500 })
  await expect.poll(() => loose.seen.maps.length).toBe(1)
  const latitudeDelta = (seen: typeof tight.seen) =>
    (seen.maps[0]!.region as { span: { latitudeDelta: number } }).span.latitudeDelta
  expect(latitudeDelta(tight.seen) * 111_320).toBeCloseTo(400, 0)
  expect(latitudeDelta(loose.seen) * 111_320).toBeCloseTo(1500, 0)
})

/** The map itself, which the message that takes its place is not. */
const drawn = (container: HTMLElement) => container.querySelector('[aria-hidden]')

it('says nothing while MapKit loads, then that the map is unavailable when it cannot', async () => {
  let resolve: (value: null) => void = () => {}
  const load = vi.fn(() => new Promise<null>((r) => (resolve = r)))
  const { container } = renderWithProviders(
    <MapKitContext.Provider value={load}>
      <LocationMap lat={1} lon={2} accuracyM={10} />
    </MapKitContext.Provider>,
  )
  await expect.poll(() => load.mock.calls.length).toBe(1)
  expect(container).toBeEmptyDOMElement()
  await act(async () => resolve(null))
  await expect.element(page.getByText(MAP_UNAVAILABLE)).toBeVisible()
  expect(page.getByText(MAP_NEEDS_CONNECTION).query()).toBeNull()
})

it('says the map is unavailable when the map cannot be made', async () => {
  const { seen, load } = setup({ accuracyM: 20 }, { mapFails: true })
  await expect.poll(() => load.mock.calls.length).toBe(1)
  await expect.element(page.getByText(MAP_UNAVAILABLE)).toBeVisible()
  expect(seen.maps).toEqual([])
})

it('says the map needs a connection when the browser is offline', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  setup({ accuracyM: 20 })
  await expect.element(page.getByText(MAP_NEEDS_CONNECTION)).toBeVisible()
  expect(page.getByText(MAP_UNAVAILABLE).query()).toBeNull()
})

it('fills the map height with its message', async () => {
  const load = vi.fn(async () => null)
  renderWithProviders(
    <MapKitContext.Provider value={load}>
      <LocationMap lat={1} lon={2} accuracyM={10} height={240} />
    </MapKitContext.Provider>,
  )
  await expect.element(page.getByText(MAP_UNAVAILABLE)).toBeVisible()
  expect(page.getByText(MAP_UNAVAILABLE).element().getBoundingClientRect().height).toBe(240)
})

it('moves the same map and its mark to a new point', async () => {
  const { seen, rerender, wrap } = setup({ accuracyM: 20 })
  await expect.poll(() => seen.annotations.length).toBe(1)
  rerender(wrap(<LocationMap lat={40} lon={-70} accuracyM={80} />))
  await expect.poll(() => seen.overlays.length).toBe(1)
  expect(seen.annotations).toEqual([])
  expect(seen.maps).toHaveLength(1)
  expect(seen.maps[0]!.destroyed).toBe(false)
  expect(seen.maps[0]!.region?.center).toMatchObject({ latitude: 40, longitude: -70 })
})

it('lets the map go when it leaves', async () => {
  const { seen, unmount } = setup({ accuracyM: 20 })
  await expect.poll(() => seen.maps.length).toBe(1)
  unmount()
  expect(seen.maps[0]!.destroyed).toBe(true)
})

it('says the map is unavailable when MapKit reports Too Many Requests', async () => {
  const { seen, dispatch } = setup({ accuracyM: 20 })
  await expect.poll(() => seen.maps.length).toBe(1)
  expect(page.getByText(MAP_UNAVAILABLE).query()).toBeNull()

  act(() => dispatch('error', { status: 'Too Many Requests' }))

  await expect.element(page.getByText(MAP_UNAVAILABLE)).toBeVisible()
  expect(seen.maps[0]!.destroyed).toBe(true)
})

it('draws the map again once MapKit configures itself after a passing error', async () => {
  const { container, seen, dispatch } = setup({ accuracyM: 20 })
  await expect.poll(() => seen.maps.length).toBe(1)
  act(() => dispatch('error', { status: 'Network Error' }))
  await expect.poll(() => drawn(container)).toBeNull()

  act(() => dispatch('configuration-change', { status: 'Refreshed' }))

  await expect.poll(() => seen.maps.length).toBe(2)
  await expect.element(drawn(container) as HTMLElement).toBeInTheDocument()
})

it('keeps the map gone once MapKit refuses its token', async () => {
  const { container, seen, dispatch } = setup({ accuracyM: 20 })
  await expect.poll(() => seen.maps.length).toBe(1)
  act(() => dispatch('error', { status: 'Unauthorized' }))
  await expect.poll(() => drawn(container)).toBeNull()

  act(() => dispatch('configuration-change', { status: 'Refreshed' }))

  await expect.poll(() => drawn(container)).toBeNull()
  expect(seen.maps).toHaveLength(1)
})

it('lets a half-built map go when the pin cannot be added', async () => {
  const { container, seen, load } = setup({ accuracyM: 20 }, { decorationFails: true })
  await expect.poll(() => load.mock.calls.length).toBe(1)
  await expect.poll(() => seen.maps.length).toBe(1)
  await expect.poll(() => drawn(container)).toBeNull()
  expect(seen.maps[0]!.destroyed).toBe(true)
})

it('keeps the map out of session replay', async () => {
  const { container, seen } = setup({ accuracyM: 20 })
  await expect.poll(() => seen.maps.length).toBe(1)
  expect(drawn(container)).toHaveClass('ph-no-capture')
})
