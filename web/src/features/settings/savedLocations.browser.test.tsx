import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { page, userEvent } from 'vitest/browser'
import { beforeEach, expect, it, vi } from 'vitest'
import { DbContext } from '../../db/DbProvider'
import type { CrosstuneDb } from '../../db/schema'
import type { MapKit } from '../../platform/mapkit'
import { MapKitContext } from '../../platform/useMapKit'
import type { SyncEngine } from '../../sync/types'
import { openTestDb } from '../../test/db'
import { fakeMapKit } from '../../test/fakeMapKit'
import { renderApp } from '../../test/renderApp'
import { placeRow, recordingRow } from '../../test/rows'
import { PLACE_LIMITS } from '../../api/vocabulary'
import { CANCEL } from '../../ui/confirmCopy'
import { AnalyticsProvider } from '../../usage/AnalyticsProvider'
import { recordingAnalytics } from '../../usage/testing'
import { NAME_LOCATION_TITLE, SAVED_LOCATIONS } from '../recordings/recordingsCopy'
import {
  DELETE_LOCATION,
  DELETE_LOCATION_MESSAGE,
  deleteLocationTitle,
  LOCATION_GONE,
  SAVED_LOCATION_NAME_LABEL,
  SAVED_LOCATIONS_EMPTY_HINT,
  SAVED_LOCATIONS_EMPTY_TITLE,
  savedLocationRecordings,
} from './settingsCopy'
import { savedLocationPath, settingsPagePath } from './settingsPaths'
import { useSavedLocations } from './useSavedLocations'

vi.mock('@clerk/react', () => import('../../fixture/clerkStub'))

const PHONE = { width: 390, height: 844 }
const WIDE = { width: 1280, height: 800 }
const LIST = settingsPagePath('saved-locations')

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

const TOWN_HALL = placeRow('p1', 'Town Hall', { address: '1 Main St, Galax, VA' })
const BARN = placeRow('p2', 'Barn', { lat: 36.7, lon: -80.9 })

async function setup(
  path: string,
  {
    places = [],
    recordings = [],
    snapshot = null,
    frame = WIDE,
  }: {
    places?: ReturnType<typeof placeRow>[]
    recordings?: ReturnType<typeof recordingRow>[]
    snapshot?: string | null
    frame?: { width: number; height: number }
  } = {},
) {
  await db.places.bulkPut(places)
  await db.recordings.bulkPut(recordings)
  const analytics = recordingAnalytics()
  const queries: Parameters<SyncEngine['placeSnapshot']>[0][] = []
  const fake = fakeMapKit()
  const load = vi.fn(async (): Promise<MapKit | null> => fake.mapkit)
  const app = await renderApp({
    path,
    db,
    frame,
    sync: {
      placeSnapshot: async (query) => {
        queries.push(query)
        return snapshot
      },
    },
    wrap: (tree) => (
      <AnalyticsProvider client={analytics}>
        <MapKitContext.Provider value={load}>{tree}</MapKitContext.Provider>
      </AnalyticsProvider>
    ),
  })
  return { ...app, analytics, queries, fake }
}

const at = (router: { state: { location: { pathname: string } } }) => () =>
  router.state.location.pathname
const link = (name: RegExp | string) => page.getByRole('link', { name })
const nameField = () => page.getByRole('textbox', { name: SAVED_LOCATION_NAME_LABEL })
const back = () => page.getByRole('main').getByRole('link', { name: SAVED_LOCATIONS })
const stored = async (id: string) => (await db.places.get(id))?.name
const sentNames = (analytics: ReturnType<typeof recordingAnalytics>) => () =>
  analytics.sends().map((event) => event.name)

/** Counts writes to the places table, whatever command made them. */
function countPlaceUpdates(): () => number {
  let count = 0
  db.places.hook('updating', () => {
    count += 1
  })
  return () => count
}

it('names what is absent and how a location gets saved when there are none', async () => {
  await setup(LIST)
  await expect.element(page.getByText(SAVED_LOCATIONS_EMPTY_TITLE)).toBeVisible()
  await expect.element(page.getByText(SAVED_LOCATIONS_EMPTY_HINT)).toBeVisible()
  expect(SAVED_LOCATIONS_EMPTY_HINT).toContain(NAME_LOCATION_TITLE)
})

it('lists the locations by name with address and how many live recordings use each', async () => {
  await setup(LIST, {
    places: [TOWN_HALL, BARN],
    recordings: [
      recordingRow('r1', { place_id: 'p1' }),
      recordingRow('r2', { place_id: 'p1' }),
      recordingRow('r3', { place_id: 'p1', deleted_at: '2026-02-01T00:00:00.000Z' }),
      recordingRow('r4', { place_id: 'p2' }),
    ],
  })
  const main = page.getByRole('main', { name: SAVED_LOCATIONS })
  const names = () =>
    main
      .getByRole('link')
      .elements()
      .map((row) => row.querySelector('span:not([aria-hidden]) > span')?.textContent)
  await expect.poll(names).toEqual(['Barn', 'Town Hall'])
  await expect
    .element(link(/^Town Hall/))
    .toHaveTextContent(`1 Main St, Galax, VA${savedLocationRecordings(2)}`)
  await expect.element(link(/^Barn/)).toHaveTextContent(savedLocationRecordings(1))
  expect(savedLocationRecordings(0)).toBe('0 recordings')
})

it('leaves a deleted location out and masks the names from session replay', async () => {
  await setup(LIST, {
    places: [TOWN_HALL, placeRow('p3', 'Gone', { deleted_at: '2026-02-01T00:00:00.000Z' })],
  })
  await expect.element(link(/^Town Hall/)).toBeVisible()
  await expect.element(page.getByText('Gone')).not.toBeInTheDocument()
  expect(
    link(/^Town Hall/)
      .element()
      .querySelector('.ph-no-capture'),
  ).not.toBeNull()
})

it('shows a map thumbnail when the server makes one', async () => {
  const { queries } = await setup(LIST, {
    places: [TOWN_HALL],
    snapshot: 'https://maps.test/a.png',
  })
  const image = () =>
    link(/^Town Hall/)
      .element()
      .querySelector('img')
  await expect.poll(() => image()?.getAttribute('src')).toBe('https://maps.test/a.png')
  expect(image()).toHaveClass('ph-no-capture')
  expect(queries[0]).toMatchObject({ lat: TOWN_HALL.lat, lon: TOWN_HALL.lon, accuracy_m: null })
})

it('opens a location at its own address, titled with its name, and browser Back returns', async () => {
  const { router, fake } = await setup(LIST, {
    places: [TOWN_HALL],
    recordings: [recordingRow('r1', { place_id: 'p1' })],
    frame: PHONE,
  })
  await link(/^Town Hall/).click()
  await expect.poll(at(router)).toBe(savedLocationPath('p1'))
  await expect.element(page.getByRole('heading', { level: 1, name: 'Town Hall' })).toBeVisible()
  await expect.element(nameField()).toHaveValue('Town Hall')
  await expect.element(page.getByRole('main').getByText('1 Main St, Galax, VA')).toBeVisible()
  await expect.element(page.getByRole('main').getByText(savedLocationRecordings(1))).toBeVisible()
  await expect.poll(() => fake.seen.maps.length).toBe(1)
  await router.navigate(-1)
  await expect.poll(at(router)).toBe(LIST)
  await expect.element(link(/^Town Hall/)).toBeVisible()
})

it("leaves a location with the bar's Back as a plain swap", async () => {
  const { router } = await setup(LIST, { places: [TOWN_HALL], frame: PHONE })
  await link(/^Town Hall/).click()
  await expect.poll(at(router)).toBe(savedLocationPath('p1'))
  await back().click()
  await expect.poll(at(router)).toBe(LIST)
  await expect.poll(() => router.state.historyAction).toBe('POP')
})

it('opens a location by its address after a refresh, and Back replaces it with the list', async () => {
  const { router } = await setup(savedLocationPath('p1'), { places: [TOWN_HALL], frame: PHONE })
  await expect.element(nameField()).toHaveValue('Town Hall')
  await back().click()
  await expect.poll(at(router)).toBe(LIST)
  await expect.element(link(/^Town Hall/)).toBeVisible()
})

it('says the location is not found for an address that names none or a deleted one', async () => {
  const { router } = await setup(savedLocationPath('nope'), {
    places: [placeRow('p3', 'Gone', { deleted_at: '2026-02-01T00:00:00.000Z' })],
  })
  await expect.element(page.getByText(LOCATION_GONE)).toBeVisible()
  await router.navigate(savedLocationPath('p3'))
  await expect.element(page.getByText(LOCATION_GONE)).toBeVisible()
  await expect.element(nameField()).not.toBeInTheDocument()
})

it('says the location is gone when it is deleted elsewhere while its page is open', async () => {
  await setup(savedLocationPath('p1'), { places: [TOWN_HALL] })
  await expect.element(nameField()).toBeVisible()
  await db.places.update('p1', { deleted_at: '2026-02-01T00:00:00.000Z' })
  await expect.element(page.getByText(LOCATION_GONE)).toBeVisible()
})

it('returns to the list when its page is chosen again from a location on wide', async () => {
  const { router } = await setup(savedLocationPath('p1'), { places: [TOWN_HALL] })
  await expect.element(nameField()).toBeVisible()
  const category = page
    .getByRole('grid')
    .getByRole('row', { name: new RegExp(`^${SAVED_LOCATIONS}`) })
  // Still shown as the open category while one of its locations is open.
  await expect.element(category).toHaveAttribute('aria-current', 'page')
  const wash = () => getComputedStyle(category.element()).backgroundColor
  const onLocation = wash()
  await category.click()
  await expect.poll(at(router)).toBe(LIST)
  await expect.element(link(/^Town Hall/)).toBeVisible()
  await expect.element(category).toHaveAttribute('aria-selected', 'true')
  await userEvent.unhover(category)
  await expect.poll(wash).toBe(onLocation)
  expect(onLocation).not.toBe(
    getComputedStyle(page.getByRole('grid').getByRole('row').first().element()).backgroundColor,
  )
})

it('renames at once with one write and one event though Enter and blur both fire', async () => {
  const { analytics } = await setup(savedLocationPath('p1'), { places: [TOWN_HALL] })
  const updates = countPlaceUpdates()
  await nameField().fill('Guild Hall')
  await userEvent.keyboard('{Enter}')
  await userEvent.tab()
  await expect.poll(() => stored('p1')).toBe('Guild Hall')
  await expect.poll(sentNames(analytics)).toEqual(['saved_location_renamed'])
  expect(analytics.sends()[0]?.props).toEqual({})
  expect(updates()).toBe(1)
})

it('renames to an over-long name once though it is committed twice', async () => {
  await db.places.bulkPut([TOWN_HALL])
  const analytics = recordingAnalytics()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DbContext.Provider value={db}>
      <AnalyticsProvider client={analytics}>{children}</AnalyticsProvider>
    </DbContext.Provider>
  )
  const { result } = renderHook(() => useSavedLocations(), { wrapper })
  const updates = countPlaceUpdates()
  const long = 'G'.repeat(PLACE_LIMITS.name + 5)
  await act(async () => {
    expect(await result.current.rename('p1', long)).toBe(true)
    expect(await result.current.rename('p1', long)).toBe(true)
  })
  expect(await stored('p1')).toBe(long.slice(0, PLACE_LIMITS.name))
  expect(updates()).toBe(1)
  expect(sentNames(analytics)()).toEqual(['saved_location_renamed'])
})

it('saves a typed name when the page is left with the field still focused', async () => {
  const { analytics, router } = await setup(savedLocationPath('p1'), { places: [TOWN_HALL] })
  await nameField().fill('Guild Hall')
  await router.navigate(LIST)
  await expect.poll(() => stored('p1')).toBe('Guild Hall')
  await expect.poll(sentNames(analytics)).toEqual(['saved_location_renamed'])
})

it('puts the stored name back when a rename is refused, and reports nothing', async () => {
  const { analytics } = await setup(savedLocationPath('p1'), { places: [TOWN_HALL] })
  await nameField().fill('   ')
  await userEvent.tab()
  await expect.element(nameField()).toHaveValue('Town Hall')
  await expect.element(page.getByRole('alert')).toBeVisible()
  expect(await stored('p1')).toBe('Town Hall')
  expect(analytics.sends()).toEqual([])
})

it('follows a rename made elsewhere while the name is not being typed', async () => {
  await setup(savedLocationPath('p1'), { places: [TOWN_HALL] })
  await expect.element(nameField()).toHaveValue('Town Hall')
  await db.places.update('p1', { name: 'Guild Hall' })
  await expect.element(nameField()).toHaveValue('Guild Hall')
})

it('keeps what is being typed when the name is renamed elsewhere meanwhile', async () => {
  await setup(savedLocationPath('p1'), { places: [TOWN_HALL] })
  await nameField().fill('Guild')
  await expect.element(nameField()).toHaveFocus()
  await db.places.update('p1', { name: 'Grange' })
  await expect.element(page.getByRole('heading', { level: 1, name: 'Grange' })).toBeVisible()
  await expect.element(nameField()).toHaveValue('Guild')
  await userEvent.type(nameField(), ' Hall')
  await userEvent.tab()
  await expect.poll(() => stored('p1')).toBe('Guild Hall')
  await expect.element(nameField()).toHaveValue('Guild Hall')
})

it('shows and keeps a name renamed elsewhere after this page committed its own', async () => {
  const { router } = await setup(savedLocationPath('p1'), { places: [TOWN_HALL] })
  await nameField().fill('Guild Hall')
  await userEvent.tab()
  await expect.poll(() => stored('p1')).toBe('Guild Hall')
  await db.places.update('p1', { name: 'Grange' })
  await expect.element(nameField()).toHaveValue('Grange')
  await nameField().click()
  await expect.element(nameField()).toHaveValue('Grange')
  await router.navigate(LIST)
  await expect.element(link(/^Grange/)).toBeVisible()
  expect(await stored('p1')).toBe('Grange')
})

it('waits on a confirmation before deleting, then deletes and returns to the list', async () => {
  const { analytics, router } = await setup(savedLocationPath('p1'), {
    places: [TOWN_HALL, BARN],
  })
  await page.getByRole('button', { name: DELETE_LOCATION }).click()
  const confirm = page.getByRole('alertdialog')
  await expect.element(confirm).toHaveTextContent(deleteLocationTitle('Town Hall'))
  await expect.element(confirm).toHaveTextContent(DELETE_LOCATION_MESSAGE)
  expect(DELETE_LOCATION_MESSAGE).toBe(
    'Its recordings keep their location and show their street address.',
  )
  await confirm.getByRole('button', { name: CANCEL }).click()
  await expect.element(confirm).not.toBeInTheDocument()
  expect((await db.places.get('p1'))?.deleted_at).toBeNull()
  expect(analytics.sends()).toEqual([])
  await page.getByRole('button', { name: DELETE_LOCATION }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect.poll(async () => (await db.places.get('p1'))?.deleted_at).not.toBeNull()
  await expect.poll(at(router)).toBe(LIST)
  await expect.element(link(/^Barn/)).toBeVisible()
  await expect.element(link(/^Town Hall/)).not.toBeInTheDocument()
  await expect
    .poll(() => analytics.sends())
    .toEqual([{ name: 'saved_location_deleted', props: {} }])
})

it('leaves the list when the location is deleted elsewhere', async () => {
  await setup(LIST, { places: [TOWN_HALL, BARN] })
  await expect.element(link(/^Town Hall/)).toBeVisible()
  await db.places.update('p1', { deleted_at: '2026-02-01T00:00:00.000Z' })
  await expect.element(link(/^Town Hall/)).not.toBeInTheDocument()
  await expect.element(link(/^Barn/)).toBeVisible()
})
