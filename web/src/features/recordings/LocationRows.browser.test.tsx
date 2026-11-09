import { act } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { SyncContext } from '../../sync/SyncProvider'
import type { PlaceHint, PlaceResult } from '../../api/types'
import type { PlaceSearchOutcome } from '../../sync/types'
import { fakeEngine } from '../../test/fakeSync'
import { renderWithProviders } from '../../test/render'
import { fillStill } from '../../test/stillPoll'
import { SETTLE_MS } from '../../ui/useSettled'
import type { PlaceChoice } from './place'
import { PlaceSearch } from './LocationRows'
import { usePlaceSearch } from './usePlaceSearch'
import {
  NO_LOCATIONS_FOUND,
  LOCATION_SEARCH_OFFLINE,
  LOCATION_SEARCH_UNAVAILABLE,
  locationSearchBusy,
  pickLocationName,
} from './recordingsCopy'

const GALAX: PlaceChoice = { name: 'Galax, VA', lat: 36.66, lon: -80.92 }
const GAINESVILLE: PlaceChoice = { name: 'Gainesville, FL', lat: 29.65, lon: -82.32 }

/** A town as search answers it: its name is its only line. */
const town = (choice: PlaceChoice): PlaceResult => ({
  ...choice,
  title: choice.name,
  subtitle: null,
  kind: 'town',
})

afterEach(() => {
  vi.useRealTimers()
})

const LABEL = 'Find a place'

function setup({
  searchPlaces = async () => ({ kind: 'ok', results: [] }),
  near = null,
  distanceOf,
}: {
  searchPlaces?: (q: string, near?: PlaceHint) => Promise<PlaceSearchOutcome>
  near?: PlaceHint | null
  distanceOf?: (at: { lat: number; lon: number }) => string | null
} = {}) {
  const onPick = vi.fn<(result: PlaceResult) => void>()
  const search = vi.fn(searchPlaces)
  function Host() {
    const [query, setQuery] = useState('')
    const placeSearch = usePlaceSearch(query, near)
    return (
      <PlaceSearch
        label={LABEL}
        query={query}
        onQueryChange={setQuery}
        search={placeSearch}
        distanceOf={distanceOf}
        onPick={onPick}
      >
        <p>After the results</p>
      </PlaceSearch>
    )
  }
  renderWithProviders(
    <SyncContext.Provider value={fakeEngine({ searchPlaces: search })}>
      <Host />
    </SyncContext.Provider>,
  )
  const input = page.getByRole('searchbox', { name: LABEL })
  return { input, onPick, search }
}

/** Types into the field with timers faked, then lets the settle time pass. */
function typeAndSettle(input: ReturnType<typeof setup>['input'], text: string) {
  fillStill(input, text)
  act(() => vi.advanceTimersByTime(SETTLE_MS))
}

const result = (name: string, detail?: string) =>
  page.getByRole('option', { name: pickLocationName(name, detail), exact: true })

it('searches once the typing settles, and hands the picked result on', async () => {
  const { input, onPick, search } = setup({
    searchPlaces: async () => ({ kind: 'ok', results: [town(GALAX)] }),
  })
  await expect.element(input).toHaveAttribute('maxlength', '100')
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  fillStill(input, 'G')
  fillStill(input, 'Ga')
  // Timers are faked, so nothing can search before they advance.
  act(() => vi.advanceTimersByTime(SETTLE_MS - 1))
  expect(search).not.toHaveBeenCalled()
  act(() => vi.advanceTimersByTime(1))
  await expect.poll(() => search.mock.calls).toEqual([['Ga', undefined]])
  vi.useRealTimers()
  await result(GALAX.name).click()
  await expect.poll(() => onPick.mock.calls).toEqual([[town(GALAX)]])
})

it('shows each result on two lines', async () => {
  const center = (state: string, lat: number): PlaceResult => ({
    name: `1038 Center St, Newton, ${state}`,
    lat,
    lon: -71.2,
    title: '1038 Center St',
    subtitle: `Newton, ${state}`,
    kind: 'address',
  })
  const venue: PlaceResult = {
    name: 'Jalopy Theatre, 315 Columbia St, Brooklyn, NY',
    lat: 40.68,
    lon: -74.0,
    title: 'Jalopy Theatre',
    subtitle: '315 Columbia St, Brooklyn, NY',
    kind: 'venue',
    address: '315 Columbia St, Brooklyn, NY',
  }
  const { input, onPick } = setup({
    searchPlaces: async () => ({
      kind: 'ok',
      results: [center('MA', 42.33), center('IA', 41.7), venue],
    }),
  })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  typeAndSettle(input, '1038 center street, newton')
  vi.useRealTimers()
  const ma = result('1038 Center St', 'Newton, MA')
  const ia = result('1038 Center St', 'Newton, IA')
  await expect.element(ma).toHaveAccessibleDescription('Newton, MA')
  await expect.element(ia).toHaveAccessibleDescription('Newton, IA')
  const jalopy = result('Jalopy Theatre', '315 Columbia St, Brooklyn, NY')
  await expect.element(jalopy).toHaveAccessibleDescription('315 Columbia St, Brooklyn, NY')
  await ia.click()
  await expect.poll(() => onPick.mock.calls).toEqual([[center('IA', 41.7)]])
})

it.each([
  ['unavailable', { kind: 'unavailable' }, LOCATION_SEARCH_UNAVAILABLE],
  ['failed', { kind: 'failed' }, LOCATION_SEARCH_UNAVAILABLE],
  ['rate limited', { kind: 'rate_limited', retryAfterSeconds: 12 }, locationSearchBusy(12)],
  ['offline', { kind: 'offline' }, LOCATION_SEARCH_OFFLINE],
] as const)('says so when search is %s, and keeps searching', async (_, outcome, message) => {
  const answers: PlaceSearchOutcome[] = [outcome, { kind: 'ok', results: [town(GALAX)] }]
  const { input, search } = setup({ searchPlaces: async () => answers.shift()! })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  typeAndSettle(input, 'Ga')
  await expect.element(page.getByText(message)).toBeVisible()
  await expect.element(input).toHaveAccessibleDescription(message)
  typeAndSettle(input, 'Gal')
  await expect
    .poll(() => search.mock.calls)
    .toEqual([
      ['Ga', undefined],
      ['Gal', undefined],
    ])
  await expect.element(result(GALAX.name)).toBeVisible()
  await expect.element(page.getByText(message)).not.toBeInTheDocument()
})

it('never lets a slow earlier answer replace a later one', async () => {
  const pending = new Map<string, (outcome: PlaceSearchOutcome) => void>()
  const settled: string[] = []
  const { input } = setup({
    searchPlaces: (q) =>
      new Promise<PlaceSearchOutcome>((resolve) => pending.set(q, resolve)).finally(() =>
        settled.push(q),
      ),
  })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  typeAndSettle(input, 'Ga')
  typeAndSettle(input, 'Gal')
  await expect.poll(() => [...pending.keys()]).toEqual(['Ga', 'Gal'])
  act(() => pending.get('Gal')!({ kind: 'ok', results: [town(GALAX)] }))
  await expect.element(result(GALAX.name)).toBeVisible()
  act(() => pending.get('Ga')!({ kind: 'ok', results: [town(GAINESVILLE)] }))
  await expect.poll(() => settled).toContain('Ga')
  await expect.element(result(GALAX.name)).toBeVisible()
  expect(result(GAINESVILLE.name).query()).toBeNull()
})

it('shows an answer only under the text it answered', async () => {
  const { input, search } = setup({
    searchPlaces: async (q) => ({ kind: 'ok', results: q === 'Ga' ? [town(GALAX)] : [] }),
  })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  typeAndSettle(input, 'Ga')
  await expect.element(result(GALAX.name)).toBeVisible()
  fillStill(input, 'Gal')
  expect(result(GALAX.name).query()).toBeNull()
  expect(page.getByText(NO_LOCATIONS_FOUND).query()).toBeNull()
  act(() => vi.advanceTimersByTime(SETTLE_MS))
  await expect
    .poll(() => search.mock.calls)
    .toEqual([
      ['Ga', undefined],
      ['Gal', undefined],
    ])
  await expect.element(page.getByText(NO_LOCATIONS_FOUND)).toBeVisible()
})

it('searches nothing for a single character', async () => {
  const { input, search } = setup()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  typeAndSettle(input, ' G ')
  expect(search).not.toHaveBeenCalled()
})

it('ranks near the hint, shows how far each result is, then what follows the results', async () => {
  const { input, search } = setup({
    near: { lat: 36.6, lon: -80.9 },
    distanceOf: (at) => (at.lat === GALAX.lat ? '4.0 mi' : null),
    searchPlaces: async () => ({ kind: 'ok', results: [town(GALAX)] }),
  })
  expect(page.getByText('After the results').query()).toBeNull()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  typeAndSettle(input, 'Ga')
  vi.useRealTimers()
  await expect.poll(() => search.mock.calls).toEqual([['Ga', { lat: 36.6, lon: -80.9 }]])
  await expect.element(result(GALAX.name).getByText('4.0 mi')).toBeVisible()
  await expect.element(page.getByText('After the results')).toBeVisible()
})
