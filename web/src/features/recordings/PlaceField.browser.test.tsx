import { act } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { SyncContext } from '../../sync/SyncProvider'
import type { PlaceResult } from '../../api/types'
import type { PlaceSearchOutcome } from '../../sync/types'
import { fakeEngine } from '../../test/fakeSync'
import { renderWithProviders } from '../../test/render'
import { Group } from '../../ui/form/Group'
import type { PlaceMethod } from '../../usage/events'
import type { PlaceChoice } from './place'
import { PlaceField } from './PlaceField'
import {
  CLEAR_LOCATION,
  NO_LOCATIONS_FOUND,
  LOCATION_LABEL,
  LOCATION_SEARCH_OFFLINE,
  LOCATION_SEARCH_UNAVAILABLE,
  locationSearchBusy,
} from './recordingsCopy'

const SETTLE_MS = 300
const GALAX: PlaceChoice = { name: 'Galax, VA', lat: 36.66, lon: -80.92 }
const AIRY: PlaceChoice = { name: 'Mount Airy, NC', lat: 36.5, lon: -80.6 }
const GAINESVILLE: PlaceChoice = { name: 'Gainesville, FL', lat: 29.65, lon: -82.32 }

/** A town as search answers it: its name is its only line. */
const town = (choice: PlaceChoice): PlaceResult => ({
  ...choice,
  title: choice.name,
  subtitle: null,
})

afterEach(() => {
  vi.useRealTimers()
})

function setup({
  start = null,
  recent = [],
  unnamed = false,
  searchPlaces = async () => ({ kind: 'ok', results: [] }),
}: {
  start?: PlaceChoice | null
  recent?: PlaceChoice[]
  /** Whether the recording opened with coordinates that have no name. */
  unnamed?: boolean
  searchPlaces?: (q: string) => Promise<PlaceSearchOutcome>
} = {}) {
  const onChange = vi.fn<(choice: PlaceChoice | null, method: PlaceMethod | null) => void>()
  const search = vi.fn(searchPlaces)
  function Host() {
    const [value, setValue] = useState(start)
    const [keepsUnnamed, setKeepsUnnamed] = useState(unnamed)
    return (
      <SyncContext.Provider value={fakeEngine({ searchPlaces: search })}>
        <Group>
          <PlaceField
            value={value}
            recent={recent}
            settleMs={SETTLE_MS}
            canClear={value !== null || keepsUnnamed}
            onChange={(choice, method) => {
              setValue(choice)
              setKeepsUnnamed(false)
              onChange(choice, method)
            }}
          />
        </Group>
      </SyncContext.Provider>
    )
  }
  renderWithProviders(<Host />)
  const input = page.getByRole('combobox', { name: LOCATION_LABEL })
  return { input, onChange, search }
}

/** Types into the focused field with timers faked, then lets the settle time pass. */
async function typeAndSettle(input: ReturnType<typeof setup>['input'], text: string) {
  await input.fill(text)
  await expect.element(input).toHaveValue(text)
  act(() => vi.advanceTimersByTime(SETTLE_MS))
}

const option = (name: string) => page.getByRole('option', { name })

it('lists the recent places on focus, and picking one is a suggestion', async () => {
  const { input, onChange, search } = setup({ recent: [GALAX, AIRY] })
  await input.click()
  await expect.element(option(GALAX.name)).toBeVisible()
  await expect.element(option(AIRY.name)).toBeVisible()
  await option(AIRY.name).click()
  await expect.poll(() => onChange.mock.calls).toEqual([[AIRY, 'suggestion']])
  await expect.element(input).toHaveValue(AIRY.name)
  expect(search).not.toHaveBeenCalled()
})

it('marks the recent location the field holds as selected', async () => {
  const { input } = setup({ start: GALAX, recent: [AIRY, GALAX] })
  await expect.element(input).toHaveValue(GALAX.name)
  await input.click()
  await expect.element(option(GALAX.name)).toHaveAttribute('aria-selected', 'true')
  await expect.element(option(AIRY.name)).toHaveAttribute('aria-selected', 'false')
  await expect.poll(() => option(GALAX.name).element().querySelector('svg')).not.toBeNull()
  expect(option(AIRY.name).element().querySelector('svg')).toBeNull()
})

it('keeps the location when the selected one is picked again after filtering', async () => {
  const { input, onChange, search } = setup({ start: GALAX, recent: [AIRY, GALAX] })
  await input.click()
  await input.fill('G')
  await expect.element(option(AIRY.name)).not.toBeInTheDocument()
  await option(GALAX.name).click()
  await expect.poll(() => onChange.mock.calls).toEqual([[GALAX, 'suggestion']])
  await expect.element(input).toHaveValue(GALAX.name)
  await expect.element(option(GALAX.name)).not.toBeInTheDocument()
  expect(search).not.toHaveBeenCalled()
})

it('searches once the typing settles, and picking a result is a search', async () => {
  const { input, onChange, search } = setup({
    searchPlaces: async () => ({ kind: 'ok', results: [town(GALAX)] }),
  })
  await input.click()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  await input.fill('G')
  await input.fill('Ga')
  await expect.element(input).toHaveValue('Ga')
  // Timers are faked, so nothing can search before they advance.
  act(() => vi.advanceTimersByTime(SETTLE_MS - 1))
  expect(search).not.toHaveBeenCalled()
  act(() => vi.advanceTimersByTime(1))
  await expect.poll(() => search.mock.calls).toEqual([['Ga']])
  vi.useRealTimers()
  await option(GALAX.name).click()
  await expect.poll(() => onChange.mock.calls).toEqual([[GALAX, 'search']])
  await expect.element(input).toHaveValue(GALAX.name)
})

it('shows each result on two lines and keeps the name of the one picked', async () => {
  const center = (state: string, lat: number): PlaceResult => ({
    name: `1038 Center St, Newton, ${state}`,
    lat,
    lon: -71.2,
    title: '1038 Center St',
    subtitle: `Newton, ${state}`,
  })
  const venue: PlaceResult = {
    name: 'Jalopy Theatre, 315 Columbia St, Brooklyn, NY',
    lat: 40.68,
    lon: -74.0,
    title: 'Jalopy Theatre',
    subtitle: '315 Columbia St, Brooklyn, NY',
  }
  const { input, onChange } = setup({
    searchPlaces: async () => ({
      kind: 'ok',
      results: [center('MA', 42.33), center('IA', 41.7), venue],
    }),
  })
  await input.click()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  await typeAndSettle(input, '1038 center street, newton')
  vi.useRealTimers()
  const addresses = page.getByRole('option', { name: '1038 Center St' })
  await expect.poll(() => addresses.elements().length).toBe(2)
  await expect.element(addresses.nth(0)).toHaveAccessibleDescription('Newton, MA')
  await expect.element(addresses.nth(1)).toHaveAccessibleDescription('Newton, IA')
  await expect
    .element(option('Jalopy Theatre'))
    .toHaveAccessibleDescription('315 Columbia St, Brooklyn, NY')
  await addresses.nth(1).click()
  await expect
    .poll(() => onChange.mock.calls)
    .toEqual([[{ name: '1038 Center St, Newton, IA', lat: 41.7, lon: -71.2 }, 'search']])
  await expect.element(input).toHaveValue('1038 Center St, Newton, IA')
})

it.each([
  ['unavailable', { kind: 'unavailable' }, LOCATION_SEARCH_UNAVAILABLE],
  ['failed', { kind: 'failed' }, LOCATION_SEARCH_UNAVAILABLE],
  ['rate limited', { kind: 'rate_limited', retryAfterSeconds: 12 }, locationSearchBusy(12)],
  ['offline', { kind: 'offline' }, LOCATION_SEARCH_OFFLINE],
] as const)('says so when search is %s, and keeps searching', async (_, outcome, message) => {
  const answers: PlaceSearchOutcome[] = [outcome, { kind: 'ok', results: [town(GALAX)] }]
  const { input, search } = setup({ searchPlaces: async () => answers.shift()! })
  await input.click()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  await typeAndSettle(input, 'Ga')
  await expect.element(page.getByText(message)).toBeVisible()
  await expect.element(input).toHaveAccessibleDescription(message)
  await typeAndSettle(input, 'Gal')
  await expect.poll(() => search.mock.calls).toEqual([['Ga'], ['Gal']])
  await expect.element(option(GALAX.name)).toBeVisible()
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
  await input.click()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  await typeAndSettle(input, 'Ga')
  await typeAndSettle(input, 'Gal')
  await expect.poll(() => [...pending.keys()]).toEqual(['Ga', 'Gal'])
  act(() => pending.get('Gal')!({ kind: 'ok', results: [town(GALAX)] }))
  await expect.element(option(GALAX.name)).toBeVisible()
  act(() => pending.get('Ga')!({ kind: 'ok', results: [town(GAINESVILLE)] }))
  await expect.poll(() => settled).toContain('Ga')
  await expect.element(option(GALAX.name)).toBeVisible()
  expect(option(GAINESVILLE.name).query()).toBeNull()
})

it('shows an answer only under the text it answered', async () => {
  const { input, search } = setup({
    searchPlaces: async (q) => ({ kind: 'ok', results: q === 'Ga' ? [town(GALAX)] : [] }),
  })
  await input.click()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  await typeAndSettle(input, 'Ga')
  await expect.element(option(GALAX.name)).toBeVisible()
  await input.fill('Gal')
  await expect.element(option(GALAX.name)).not.toBeInTheDocument()
  await expect.element(page.getByText(NO_LOCATIONS_FOUND)).not.toBeInTheDocument()
  act(() => vi.advanceTimersByTime(SETTLE_MS))
  await expect.poll(() => search.mock.calls).toEqual([['Ga'], ['Gal']])
  await expect.element(page.getByText(NO_LOCATIONS_FOUND)).toBeVisible()
})

it('clears coordinates that have no name', async () => {
  const { input, onChange } = setup({ unnamed: true })
  await expect.element(input).toHaveValue('')
  const clear = page.getByRole('button', { name: CLEAR_LOCATION })
  await expect.element(clear).toBeEnabled()
  await clear.click()
  await expect.poll(() => onChange.mock.calls).toEqual([[null, null]])
  await expect.element(clear).toBeDisabled()
})

it('keeps the disabled Clear its name and target size', async () => {
  setup({ start: GALAX })
  const clear = page.getByRole('button', { name: CLEAR_LOCATION })
  await expect.element(clear).toBeEnabled()
  // Layout size, which the press scale does not change.
  const size = () => {
    const el = clear.element() as HTMLElement
    return [el.offsetWidth, el.offsetHeight]
  }
  const enabled = size()
  await clear.click()
  await expect.element(clear).toBeDisabled()
  await expect.element(clear).toHaveAccessibleName(CLEAR_LOCATION)
  expect(size()).toEqual(enabled)
  expect(Math.min(...enabled)).toBeGreaterThanOrEqual(24)
})

it('clears the place', async () => {
  const { input, onChange } = setup({ start: GALAX })
  await expect.element(input).toHaveValue(GALAX.name)
  await page.getByRole('button', { name: CLEAR_LOCATION }).click()
  await expect.poll(() => onChange.mock.calls).toEqual([[null, null]])
  await expect.element(input).toHaveValue('')
  await expect.element(page.getByRole('button', { name: CLEAR_LOCATION })).toBeDisabled()
})
