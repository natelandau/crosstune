import { act } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { SyncContext } from '../../sync/SyncProvider'
import type { PlaceResult } from '../../api/types'
import type { PlaceSearchOutcome } from '../../sync/types'
import { fakeEngine } from '../../test/fakeSync'
import { renderWithProviders } from '../../test/render'
import type { PlaceChoice } from './place'
import { PlaceSearch } from './LocationRows'
import {
  NO_LOCATIONS_FOUND,
  LOCATION_SEARCH_OFFLINE,
  LOCATION_SEARCH_UNAVAILABLE,
  locationSearchBusy,
  pickLocationName,
  SEARCH_LOCATIONS,
} from './recordingsCopy'

const SETTLE_MS = 300
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

function setup({
  searchPlaces = async () => ({ kind: 'ok', results: [] }),
}: {
  searchPlaces?: (q: string) => Promise<PlaceSearchOutcome>
} = {}) {
  const onPick = vi.fn<(result: PlaceResult) => void>()
  const search = vi.fn(searchPlaces)
  renderWithProviders(
    <SyncContext.Provider value={fakeEngine({ searchPlaces: search })}>
      <PlaceSearch settleMs={SETTLE_MS} onPick={onPick} />
    </SyncContext.Provider>,
  )
  const input = page.getByRole('searchbox', { name: SEARCH_LOCATIONS })
  return { input, onPick, search }
}

/** Types into the field with timers faked, then lets the settle time pass. */
async function typeAndSettle(input: ReturnType<typeof setup>['input'], text: string) {
  await input.fill(text)
  await expect.element(input).toHaveValue(text)
  act(() => vi.advanceTimersByTime(SETTLE_MS))
}

const result = (name: string, detail?: string) =>
  page.getByRole('button', { name: pickLocationName(name, detail), exact: true })

it('searches once the typing settles, and hands the picked result on', async () => {
  const { input, onPick, search } = setup({
    searchPlaces: async () => ({ kind: 'ok', results: [town(GALAX)] }),
  })
  await expect.element(input).toHaveAttribute('maxlength', '100')
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  await input.fill('G')
  await input.fill('Ga')
  // Interval 0: under fake timers each miss would advance them by the interval, into the wait.
  await expect.element(input, { interval: 0 }).toHaveValue('Ga')
  // Timers are faked, so nothing can search before they advance.
  act(() => vi.advanceTimersByTime(SETTLE_MS - 1))
  expect(search).not.toHaveBeenCalled()
  act(() => vi.advanceTimersByTime(1))
  await expect.poll(() => search.mock.calls).toEqual([['Ga']])
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
  await typeAndSettle(input, '1038 center street, newton')
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
  await typeAndSettle(input, 'Ga')
  await expect.element(page.getByText(message)).toBeVisible()
  await expect.element(input).toHaveAccessibleDescription(message)
  await typeAndSettle(input, 'Gal')
  await expect.poll(() => search.mock.calls).toEqual([['Ga'], ['Gal']])
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
  await typeAndSettle(input, 'Ga')
  await typeAndSettle(input, 'Gal')
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
  await typeAndSettle(input, 'Ga')
  await expect.element(result(GALAX.name)).toBeVisible()
  await input.fill('Gal')
  await expect.element(result(GALAX.name)).not.toBeInTheDocument()
  await expect.element(page.getByText(NO_LOCATIONS_FOUND)).not.toBeInTheDocument()
  act(() => vi.advanceTimersByTime(SETTLE_MS))
  await expect.poll(() => search.mock.calls).toEqual([['Ga'], ['Gal']])
  await expect.element(page.getByText(NO_LOCATIONS_FOUND)).toBeVisible()
})

it('searches nothing for a single character', async () => {
  const { input, search } = setup()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  await typeAndSettle(input, ' G ')
  expect(search).not.toHaveBeenCalled()
})
