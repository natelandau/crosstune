import { useState } from 'react'
import { page, userEvent } from 'vitest/browser'
import { beforeEach, expect, it, vi } from 'vitest'
import type { PlaceResult } from '../../api/types'
import { renameSavedPlace } from '../../commands/places'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalPlace } from '../../db/types'
import type { MapKit } from '../../platform/mapkit'
import { MapKitContext } from '../../platform/useMapKit'
import type { PlaceSearchOutcome } from '../../sync/types'
import { openTestDb } from '../../test/db'
import { fakeMapKit, type FakeMapKitOptions } from '../../test/fakeMapKit'
import { fakeLocationPermissionForTest } from '../../test/fakeLocationPermission'
import { dataProviders, fakeEngine } from '../../test/providers'
import { renderWithProviders } from '../../test/render'
import { placeRow, recordingRow } from '../../test/rows'
import { seen } from '../../test/events'
import { BACK } from '../../ui/confirmCopy'
import { recordingAnalytics } from '../../usage/testing'
import { EditRecordingSheet } from './EditRecordingSheet'
import { mapsUrl } from './place'
import {
  CLEAR_LOCATION,
  CURRENT_LOCATION,
  EDIT_RECORDING_TITLE,
  LOCATION_ACCESS_OFF,
  LOCATION_LABEL,
  LOCATION_NAME_LABEL,
  locationRowName,
  NAME_LOCATION_TITLE,
  NAME_THIS_LOCATION,
  NEARBY_LOCATIONS,
  OPEN_IN_MAPS,
  pickLocationName,
  RECENT_LOCATIONS,
  SAVE_LOCATION_NAME,
  SAVE_RECORDING,
  SAVED_HERE,
  SAVED_LOCATIONS,
  SEARCH_LOCATIONS,
} from './recordingsCopy'
import type { RecordingView } from './useRecordings'

const STREET = '200 Eastern Pkwy, Brooklyn, NY'
const SPOT = { lat: 40.6718, lon: -73.9635 }
const M_PER_DEGREE = 111_320
/** A point `meters` due north of the take. */
const north = (meters: number) => ({ lat: SPOT.lat + meters / M_PER_DEGREE, lon: SPOT.lon })

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

const captured = (extra: Parameters<typeof recordingRow>[1] = {}) =>
  recordingRow('r1', {
    label: 'Fast take',
    place_name: STREET,
    place_lat: SPOT.lat,
    place_lon: SPOT.lon,
    place_accuracy_m: 12,
    place_origin: 'device',
    ...extra,
  })

async function setup({
  recording = captured(),
  places = [],
  others = [],
  mapkit,
  searchPlaces = async () => ({ kind: 'ok', results: [] }),
  initialPage,
}: {
  recording?: ReturnType<typeof recordingRow>
  places?: LocalPlace[]
  others?: ReturnType<typeof recordingRow>[]
  /** MapKit's stand-in; left out, MapKit never loads. */
  mapkit?: FakeMapKitOptions
  searchPlaces?: (q: string) => Promise<PlaceSearchOutcome>
  initialPage?: 'location'
} = {}) {
  await db.recordings.bulkPut([recording, ...others])
  if (places.length) await db.places.bulkPut(places)
  const analytics = recordingAnalytics()
  const fake = mapkit ? fakeMapKit(mapkit) : null
  const load = vi.fn(async (): Promise<MapKit | null> => fake?.mapkit ?? null)
  const Data = dataProviders({ db, analytics, engine: fakeEngine({ searchPlaces }) })
  const view: RecordingView = { recording, file: undefined, tuneId: null, tuneTitle: null }
  function Host() {
    const [shown, setShown] = useState<RecordingView | null>(view)
    return (
      <EditRecordingSheet
        view={shown}
        onClose={() => setShown(null)}
        initialPage={initialPage}
        settleMs={0}
      />
    )
  }
  renderWithProviders(
    <Data>
      <MapKitContext.Provider value={load}>
        <Host />
      </MapKitContext.Provider>
    </Data>,
  )
  return { analytics, seen: fake?.seen ?? null }
}

const form = () => page.getByRole('dialog', { name: EDIT_RECORDING_TITLE })
const locationPage = () => page.getByRole('dialog', { name: LOCATION_LABEL })
const row = (name: string) => page.getByRole('button', { name, exact: true })
const section = (name: string) => page.getByRole('region', { name })

async function openPage(name: string | null = STREET) {
  await form()
    .getByRole('button', { name: locationRowName(name) })
    .click()
  await expect.element(locationPage()).toBeVisible()
}

async function saveSheet() {
  await form().getByRole('button', { name: SAVE_RECORDING, exact: true }).click()
  await expect.element(form()).not.toBeInTheDocument()
}

it('opens the location page from the Location row, and Back returns with the pick', async () => {
  const galax = { place_name: 'Galax, VA', place_lat: 36.66, place_lon: -80.92 }
  await setup({ others: [recordingRow('r2', galax)] })
  await openPage()
  await expect.element(locationPage().getByRole('button', { name: BACK })).toBeVisible()
  await expect.element(section(RECENT_LOCATIONS)).toBeVisible()
  await row(pickLocationName(galax.place_name)).click()
  await expect.element(form()).toBeVisible()
  const location = form().getByRole('button', { name: locationRowName(galax.place_name) })
  await expect.element(location).toHaveFocus()
  await openPage(galax.place_name)
  await locationPage().getByRole('button', { name: BACK }).click()
  await expect.element(location).toBeVisible()
  await saveSheet()
  await expect.poll(async () => (await db.recordings.get('r1'))?.place_name).toBe('Galax, VA')
})

it('goes back on Escape from the location page, rather than closing', async () => {
  await setup()
  await openPage()
  const escapes = seen('keyup', (event) => (event as KeyboardEvent).key === 'Escape')
  await userEvent.keyboard('{Escape}')
  await expect.poll(escapes).toBe(1)
  await expect.element(form()).toBeVisible()
  await expect.element(form().getByRole('button', { name: locationRowName(STREET) })).toBeVisible()
})

it('opens on the location page when asked', async () => {
  await setup({ initialPage: 'location' })
  await expect.element(locationPage()).toBeVisible()
  await expect.element(section(CURRENT_LOCATION).getByText(STREET)).toBeVisible()
})

it('shows the map only with coordinates', async () => {
  const { seen } = await setup({ mapkit: {}, initialPage: 'location' })
  await expect.poll(() => seen!.maps.length).toBe(1)
  await expect.poll(() => seen!.annotations.length).toBe(1)
})

it('shows no map, no Current, and puts focus in the search with no location', async () => {
  const { seen } = await setup({
    recording: recordingRow('r1', { label: 'Fast take' }),
    mapkit: {},
    initialPage: 'location',
  })
  const search = page.getByRole('searchbox', { name: SEARCH_LOCATIONS })
  await expect.element(search).toHaveFocus()
  expect(section(CURRENT_LOCATION).query()).toBeNull()
  expect(seen!.maps).toEqual([])
  expect(seen!.searches).toEqual([])
})

it('keeps Current, saved, recent, search, and Clear when MapKit fails to load', async () => {
  const galax = { place_name: 'Galax, VA', place_lat: 36.66, place_lon: -80.92 }
  await setup({
    places: [placeRow('p1', 'The barn', north(40))],
    others: [recordingRow('r2', galax)],
    initialPage: 'location',
  })
  const current = section(CURRENT_LOCATION)
  await expect.element(current.getByText(STREET)).toBeVisible()
  await expect.element(current.getByRole('button', { name: CLEAR_LOCATION })).toBeVisible()
  await expect.element(section(SAVED_LOCATIONS).getByText('The barn')).toBeVisible()
  await expect.element(section(RECENT_LOCATIONS).getByText(galax.place_name)).toBeVisible()
  await expect.element(page.getByRole('searchbox', { name: SEARCH_LOCATIONS })).toBeVisible()
  expect(section(NEARBY_LOCATIONS).query()).toBeNull()
})

it('lists saved locations first in Nearby, then venues by distance', async () => {
  const far = north(120)
  const near = north(20)
  const barn = north(100)
  await setup({
    places: [
      placeRow('p1', 'The barn', { ...barn, apple_place_id: 'id-Barn venue' }),
      placeRow('p2', 'Far away', north(400)),
    ],
    mapkit: {
      places: [
        { id: 'v-far', name: 'Far venue', coordinate: { latitude: far.lat, longitude: far.lon } },
        // Saved already, so it shows once, as the saved location.
        {
          id: 'id-Barn venue',
          name: 'Barn venue',
          coordinate: { latitude: barn.lat, longitude: barn.lon },
        },
        {
          id: 'v-near',
          name: 'Near venue',
          coordinate: { latitude: near.lat, longitude: near.lon },
        },
      ],
    },
    initialPage: 'location',
  })
  const nearby = section(NEARBY_LOCATIONS)
  await expect.element(nearby).toBeVisible()
  await expect
    .poll(() =>
      nearby
        .getByRole('button')
        .elements()
        .map((el) => el.textContent),
    )
    .toEqual(['The barn', 'Near venue', 'Far venue'])
})

it('leaves out a venue saved already under its name within 30 m, with or without an Apple id', async () => {
  const hall = north(60)
  await setup({
    places: [placeRow('p1', 'Grange hall', hall)],
    mapkit: {
      places: [
        {
          id: 'v-hall',
          name: ' grange HALL',
          coordinate: { latitude: hall.lat + 10 / M_PER_DEGREE, longitude: hall.lon },
        },
        { id: 'v-cafe', name: 'Cafe', coordinate: { latitude: hall.lat, longitude: hall.lon } },
      ],
    },
    initialPage: 'location',
  })
  const nearby = section(NEARBY_LOCATIONS)
  await expect
    .poll(() =>
      nearby
        .getByRole('button')
        .elements()
        .map((el) => el.textContent),
    )
    .toEqual(['Grange hall', 'Cafe'])
})

it('keeps location names and rows out of session replay', async () => {
  const galax = { place_name: 'Galax, VA', place_lat: 36.66, place_lon: -80.92 }
  await setup({
    places: [placeRow('p1', 'The barn', north(40))],
    others: [recordingRow('r2', galax)],
    initialPage: 'location',
  })
  await expect.element(section(CURRENT_LOCATION).getByText(STREET)).toHaveClass(/ph-no-capture/)
  await expect.element(row(pickLocationName('The barn'))).toHaveClass(/ph-no-capture/)
  await expect.element(row(pickLocationName(galax.place_name))).toHaveClass(/ph-no-capture/)
})

it('hides only Nearby when the venue search fails', async () => {
  const { seen } = await setup({ mapkit: { searchFails: true }, initialPage: 'location' })
  await expect.poll(() => seen!.searches.length).toBe(1)
  await expect.poll(() => seen!.maps.length).toBe(1)
  await expect.element(section(CURRENT_LOCATION)).toBeVisible()
  expect(section(NEARBY_LOCATIONS).query()).toBeNull()
})

it('picking a nearby venue saves it as a location on Save', async () => {
  const venue = north(30)
  const { analytics } = await setup({
    mapkit: {
      places: [
        {
          id: 'I1234',
          name: 'Rex Theater',
          coordinate: { latitude: venue.lat, longitude: venue.lon },
          fullThoroughfare: '113 E Grayson St',
        },
      ],
    },
  })
  await openPage()
  await section(NEARBY_LOCATIONS)
    .getByRole('button', { name: pickLocationName('Rex Theater', '113 E Grayson St'), exact: true })
    .click()
  await expect
    .element(form().getByRole('button', { name: locationRowName('Rex Theater') }))
    .toBeVisible()
  expect(await db.places.count()).toBe(0)
  await saveSheet()
  await expect.poll(() => db.places.count()).toBe(1)
  const [place] = await db.places.toArray()
  expect(place).toMatchObject({ name: 'Rex Theater', apple_place_id: 'I1234', ...venue })
  expect(await db.recordings.get('r1')).toMatchObject({ place_id: place!.id, ...placeOf() })
  expect(analytics.sends()).toContainEqual({
    name: 'saved_location_created',
    props: { method: 'nearby' },
  })
})

it('hides Name this location for a loose fix', async () => {
  await setup({ recording: captured({ place_accuracy_m: 120 }), initialPage: 'location' })
  await expect.element(section(CURRENT_LOCATION).getByText(STREET)).toBeVisible()
  expect(row(NAME_THIS_LOCATION).query()).toBeNull()
})

it('names this location: a saved location at the take, linked on Save', async () => {
  const { analytics } = await setup({ initialPage: 'location' })
  await row(NAME_THIS_LOCATION).click()
  const naming = page.getByRole('dialog', { name: NAME_LOCATION_TITLE })
  const name = naming.getByRole('textbox', { name: LOCATION_NAME_LABEL })
  await expect.element(name).toHaveFocus()
  await expect.element(naming.getByRole('button', { name: SAVE_LOCATION_NAME })).toBeDisabled()
  await name.fill('Tom’s kitchen')
  await userEvent.keyboard('{Enter}')
  await expect
    .element(form().getByRole('button', { name: locationRowName('Tom’s kitchen') }))
    .toBeVisible()
  expect(await db.places.count()).toBe(0)
  await saveSheet()
  await expect.poll(() => db.places.count()).toBe(1)
  const [place] = await db.places.toArray()
  expect(place).toMatchObject({ name: 'Tom’s kitchen', address: STREET, ...SPOT })
  expect(await db.recordings.get('r1')).toMatchObject({ place_id: place!.id, place_name: STREET })
  expect(analytics.sends()).toContainEqual({
    name: 'saved_location_created',
    props: { method: 'custom' },
  })
})

it('offers the saved locations within 30 m first when naming, and Back returns to the page', async () => {
  await setup({
    places: [
      placeRow('p1', 'Upstairs flat', north(20)),
      placeRow('p2', 'The bar', north(5)),
      placeRow('p3', 'Down the road', north(80)),
    ],
    initialPage: 'location',
  })
  await row(NAME_THIS_LOCATION).click()
  const savedHere = section(SAVED_HERE)
  await expect
    .poll(() =>
      savedHere
        .getByRole('button')
        .elements()
        .map((el) => el.textContent),
    )
    .toEqual(['The bar', 'Upstairs flat'])
  await userEvent.keyboard('{Escape}')
  await expect.element(locationPage()).toBeVisible()
  await row(NAME_THIS_LOCATION).click()
  await section(SAVED_HERE)
    .getByRole('button', { name: pickLocationName('Upstairs flat'), exact: true })
    .click()
  await saveSheet()
  await expect.poll(async () => (await db.recordings.get('r1'))?.place_id).toBe('p1')
  expect(await db.places.count()).toBe(3)
})

it('follows a rename of the linked saved location while open', async () => {
  await setup({
    recording: captured({ place_id: 'p1' }),
    places: [placeRow('p1', 'The barn', SPOT)],
    initialPage: 'location',
  })
  const current = section(CURRENT_LOCATION)
  await expect.element(current.getByText('The barn')).toBeVisible()
  await renameSavedPlace(db, 'p1', 'Barn dance hall')
  await expect.element(current.getByText('Barn dance hall')).toBeVisible()
  await expect
    .element(
      section(SAVED_LOCATIONS).getByRole('button', {
        name: pickLocationName('Barn dance hall'),
        exact: true,
      }),
    )
    .toHaveAttribute('aria-current', 'true')
})

it('shows the saved name for a linked take with no name of its own', async () => {
  await setup({
    recording: captured({ place_id: 'p1', place_name: null }),
    places: [placeRow('p1', 'The barn', { ...SPOT, address: STREET })],
  })
  await openPage('The barn')
  const current = section(CURRENT_LOCATION)
  await expect.element(current.getByText('The barn')).toBeVisible()
  await expect.element(current.getByText(STREET)).toBeVisible()
})

it('picking a searched venue saves it, and a town saves none', async () => {
  const venue: PlaceResult = {
    name: 'Jalopy Theatre, 315 Columbia St, Brooklyn, NY',
    lat: 40.6845,
    lon: -74.0019,
    title: 'Jalopy Theatre',
    subtitle: '315 Columbia St, Brooklyn, NY',
    kind: 'venue',
    address: '315 Columbia St, Brooklyn, NY',
  }
  await setup({ searchPlaces: async () => ({ kind: 'ok', results: [venue] }) })
  await openPage()
  await page.getByRole('searchbox', { name: SEARCH_LOCATIONS }).fill('jalopy')
  await row(pickLocationName('Jalopy Theatre', venue.subtitle)).click()
  await saveSheet()
  await expect.poll(() => db.places.count()).toBe(1)
  expect((await db.places.toArray())[0]).toMatchObject({
    name: 'Jalopy Theatre',
    address: venue.address,
  })
  expect(await db.recordings.get('r1')).toMatchObject({
    place_name: venue.name,
    place_lat: venue.lat,
    place_accuracy_m: null,
  })
})

it('opens Apple Maps at the saved location’s point, sending nothing of where', async () => {
  const barn = { lat: 40.672, lon: -73.9636 }
  const { analytics } = await setup({
    recording: captured({ place_id: 'p1' }),
    places: [placeRow('p1', 'The barn', barn)],
    initialPage: 'location',
  })
  const link = page.getByRole('link', { name: OPEN_IN_MAPS })
  await expect.element(link).toHaveAttribute('href', mapsUrl(barn, 'The barn'))
  await expect.element(link).toHaveAttribute('target', '_blank')
  // Kept from opening a tab, which the test browser would leave behind.
  link.element().addEventListener('click', (event) => event.preventDefault(), { once: true })
  await link.click()
  await expect
    .poll(() => analytics.sends())
    .toEqual([{ name: 'location_opened_in_maps', props: {} }])
})

it('builds the Apple Maps link from the point and name', () => {
  expect(mapsUrl({ lat: 36.66, lon: -80.92 }, 'Rex & Co')).toBe(
    'https://maps.apple.com/?ll=36.66%2C-80.92&q=Rex+%26+Co',
  )
  expect(mapsUrl({ lat: 1, lon: 2 }, null)).toBe('https://maps.apple.com/?ll=1%2C2')
})

it('clears the location from the page and returns to the form', async () => {
  await setup({ initialPage: 'location' })
  await section(CURRENT_LOCATION).getByRole('button', { name: CLEAR_LOCATION }).click()
  await expect.element(form().getByRole('button', { name: locationRowName(null) })).toBeVisible()
  await saveSheet()
  await expect.poll(async () => (await db.recordings.get('r1'))?.place_lat).toBeNull()
})

it('offers Clear location on the form only with a location, keeping focus on the field', async () => {
  await setup()
  const clear = form().getByRole('button', { name: CLEAR_LOCATION })
  await clear.click()
  await expect.element(clear).not.toBeInTheDocument()
  await expect.element(form().getByRole('button', { name: locationRowName(null) })).toHaveFocus()
})

it('shows no Clear location on the form for a take with no location', async () => {
  await setup({ recording: recordingRow('r1', { label: 'Fast take' }) })
  await expect.element(form().getByRole('button', { name: locationRowName(null) })).toBeVisible()
  expect(form().getByRole('button', { name: CLEAR_LOCATION }).query()).toBeNull()
})

it('says on the page that location access is off, while it is', async () => {
  const permission = fakeLocationPermissionForTest('denied')
  await setup({ initialPage: 'location' })
  await expect.element(locationPage().getByText(LOCATION_ACCESS_OFF)).toBeVisible()
  permission.set('prompt')
  await expect.element(locationPage().getByText(LOCATION_ACCESS_OFF)).not.toBeInTheDocument()
})

function placeOf() {
  return { place_name: STREET, place_lat: SPOT.lat, place_lon: SPOT.lon, place_accuracy_m: 12 }
}
