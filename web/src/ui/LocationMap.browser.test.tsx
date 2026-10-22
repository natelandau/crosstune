import { act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, it, vi } from 'vitest'
import { MapKitContext } from '../platform/useMapKit'
import { fakeMapKit, type FakeMapKitOptions } from '../test/fakeMapKit'
import { renderWithProviders } from '../test/render'
import { LocationMap } from './LocationMap'

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

it('draws nothing until MapKit has loaded', async () => {
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
  expect(container).toBeEmptyDOMElement()
})

it('draws nothing when the map cannot be made', async () => {
  const { container, seen, load } = setup({ accuracyM: 20 }, { mapFails: true })
  await expect.poll(() => load.mock.calls.length).toBe(1)
  await act(async () => {})
  expect(seen.maps).toEqual([])
  expect(container).toBeEmptyDOMElement()
})

it('moves to a new point with a new map and lets the old one go', async () => {
  const { seen, rerender, wrap } = setup({ accuracyM: 20 })
  await expect.poll(() => seen.maps.length).toBe(1)
  rerender(wrap(<LocationMap lat={40} lon={-70} accuracyM={20} />))
  await expect.poll(() => seen.maps.length).toBe(2)
  expect(seen.maps[0]!.destroyed).toBe(true)
  expect(seen.maps[1]!.destroyed).toBe(false)
})

it('lets the map go when it leaves', async () => {
  const { seen, unmount } = setup({ accuracyM: 20 })
  await expect.poll(() => seen.maps.length).toBe(1)
  unmount()
  expect(seen.maps[0]!.destroyed).toBe(true)
})

it('draws nothing when MapKit reports Too Many Requests', async () => {
  const { container, seen, dispatch } = setup({ accuracyM: 20 })
  await expect.poll(() => seen.maps.length).toBe(1)
  expect(container.firstChild).not.toBeNull()

  act(() => dispatch('error', { status: 'Too Many Requests' }))

  await expect.poll(() => container.firstChild).toBeNull()
  expect(seen.maps[0]!.destroyed).toBe(true)
})

it('draws the map again once MapKit configures itself after a passing error', async () => {
  const { container, seen, dispatch } = setup({ accuracyM: 20 })
  await expect.poll(() => seen.maps.length).toBe(1)
  act(() => dispatch('error', { status: 'Network Error' }))
  await expect.poll(() => container.firstChild).toBeNull()

  act(() => dispatch('configuration-change', { status: 'Refreshed' }))

  await expect.poll(() => seen.maps.length).toBe(2)
  await expect.element(container.firstChild as HTMLElement).toBeInTheDocument()
})

it('keeps the map gone once MapKit refuses its token', async () => {
  const { container, seen, dispatch } = setup({ accuracyM: 20 })
  await expect.poll(() => seen.maps.length).toBe(1)
  act(() => dispatch('error', { status: 'Unauthorized' }))
  await expect.poll(() => container.firstChild).toBeNull()

  act(() => dispatch('configuration-change', { status: 'Refreshed' }))

  await expect.poll(() => container.firstChild).toBeNull()
  expect(seen.maps).toHaveLength(1)
})

it('lets a half-built map go when the pin cannot be added', async () => {
  const { container, seen, load } = setup({ accuracyM: 20 }, { decorationFails: true })
  await expect.poll(() => load.mock.calls.length).toBe(1)
  await expect.poll(() => seen.maps.length).toBe(1)
  await expect.poll(() => container.firstChild).toBeNull()
  expect(seen.maps[0]!.destroyed).toBe(true)
})

it('keeps the map out of session replay', async () => {
  const { container, seen } = setup({ accuracyM: 20 })
  await expect.poll(() => seen.maps.length).toBe(1)
  expect(container.firstChild).toHaveClass('ph-no-capture')
})
