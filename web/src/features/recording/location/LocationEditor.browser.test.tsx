import { useState } from 'react'
import { page, userEvent } from 'vitest/browser'
import { act } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import type { PlaceHint, PlaceResult } from '../../../api/types'
import { PLACE_NAME_REQUIRED } from '../../../commands/messages'
import type { CrosstuneDb } from '../../../db/schema'
import type { LocalPlace, LocalRecording } from '../../../db/types'
import type { MapKit } from '../../../platform/mapkit'
import { MapKitContext } from '../../../platform/useMapKit'
import type { PlaceSearchOutcome } from '../../../sync/types'
import { openTestDb } from '../../../test/db'
import { fakeLocationPermissionForTest } from '../../../test/fakeLocationPermission'
import { MAP_NEEDS_CONNECTION, MAP_UNAVAILABLE } from '../../../ui/LocationMap'
import { fakeMapKit, type FakeMapKitOptions } from '../../../test/fakeMapKit'
import { dataProviders, fakeEngine } from '../../../test/providers'
import { renderWithProviders } from '../../../test/render'
import { placeRow, recordingRow } from '../../../test/rows'
import { fillStill } from '../../../test/stillPoll'
import { BACK, CANCEL, DONE } from '../../../ui/confirmCopy'
import { SETTLE_MS } from '../../../ui/useSettled'
import type { LocationPermission } from '../../../platform/locationPermission'
import { recordingAnalytics } from '../../../usage/testing'
import { mapsUrl } from '../../recordings/place'
import {
  CLEAR_LOCATION,
  CURRENT_LOCATION,
  LOCATION_ACCESS_OFF,
  LOCATION_LABEL,
  LOCATION_NAME_LABEL,
  NAME_LOCATION_TITLE,
  NAME_THIS_LOCATION,
  NEARBY_LOCATIONS,
  NO_LOCATIONS_FOUND,
  OPEN_IN_MAPS,
  pickLocationName,
  RECENT_LOCATIONS,
  RENAME_THIS_LOCATION,
  SAVED_LOCATIONS,
} from '../../recordings/recordingsCopy'
import type { RecordingView } from '../../recordings/useRecordings'
import { LocationEditor } from './LocationEditor'
import {
  CANT_FIND_IT,
  DROP_A_PIN,
  FIND_A_PLACE,
  NO_CURRENT_LOCATION,
  USE_CURRENT_LOCATION,
} from './locationEditorCopy'

const STREET = '200 Eastern Pkwy, Brooklyn, NY'
const SPOT = { lat: 40.6718, lon: -73.9635 }
const DEVICE = { lat: 36.66, lon: -80.92 }
const M_PER_DEGREE = 111_320
/** A point `meters` due north of the recording. */
const north = (meters: number) => ({ lat: SPOT.lat + meters / M_PER_DEGREE, lon: SPOT.lon })
const PIN_ROW = `${CANT_FIND_IT} ${DROP_A_PIN}`

const JALOPY: PlaceResult = {
  name: 'Jalopy Theatre, 315 Columbia St, Brooklyn, NY',
  lat: 40.6845,
  lon: -74.0019,
  title: 'Jalopy Theatre',
  subtitle: '315 Columbia St, Brooklyn, NY',
  kind: 'venue',
  address: '315 Columbia St, Brooklyn, NY',
}

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(() => {
  vi.useRealTimers()
})

const captured = (extra: Partial<LocalRecording> = {}) =>
  recordingRow('r1', {
    label: 'Fast version',
    place_name: STREET,
    place_lat: SPOT.lat,
    place_lon: SPOT.lon,
    place_accuracy_m: 12,
    place_origin: 'device',
    ...extra,
  })

/**
 * Answers `navigator.geolocation` with `at` for one test, or a refusal for null. A held answer
 * waits for the returned `release`.
 */
function fakeGeolocation(at: { lat: number; lon: number; accuracy: number } | null, held: boolean) {
  const waiting: (() => void)[] = []
  let now = at
  let reads = 0
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'geolocation')
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (
        ok: (position: {
          coords: { latitude: number; longitude: number; accuracy: number }
        }) => void,
        fail?: (error: unknown) => void,
      ) => {
        reads += 1
        const answer = () => {
          if (!now) return fail?.({ code: 1 })
          ok({ coords: { latitude: now.lat, longitude: now.lon, accuracy: now.accuracy } })
        }
        if (held) waiting.push(answer)
        else answer()
      },
    },
  })
  onTestFinished(() => {
    if (descriptor) Object.defineProperty(navigator, 'geolocation', descriptor)
    else Reflect.deleteProperty(navigator, 'geolocation')
  })
  const release = () => waiting.splice(0).forEach((answer) => answer())
  /** Changes what the next read answers. */
  release.answerWith = (next: typeof at) => {
    now = next
  }
  /** How many times the device's location was read. */
  release.reads = () => reads
  return release
}

async function setup({
  recording = captured(),
  places = [],
  mapkit,
  mapkitLoading = false,
  permission = 'unknown',
  device = null,
  holdDevice = false,
  searchPlaces = async () => ({ kind: 'ok', results: [] }),
}: {
  recording?: LocalRecording
  places?: LocalPlace[]
  /** MapKit's fake; left out, MapKit never loads. */
  mapkit?: FakeMapKitOptions
  /** Holds MapKit's load, so it never finishes. */
  mapkitLoading?: boolean
  permission?: LocationPermission
  device?: { lat: number; lon: number; accuracy: number } | null
  /** Holds the device's answer until `releaseDevice`. */
  holdDevice?: boolean
  searchPlaces?: (q: string, near?: PlaceHint) => Promise<PlaceSearchOutcome>
} = {}) {
  fakeLocationPermissionForTest(permission)
  const releaseDevice = fakeGeolocation(device, holdDevice)
  await db.recordings.put(recording)
  if (places.length) await db.places.bulkPut(places)
  const analytics = recordingAnalytics()
  const fake = mapkit ? fakeMapKit(mapkit) : null
  const load = vi.fn((): Promise<MapKit | null> =>
    mapkitLoading ? new Promise(() => {}) : Promise.resolve(fake?.mapkit ?? null),
  )
  const search = vi.fn(searchPlaces)
  const Data = dataProviders({ db, analytics, engine: fakeEngine({ searchPlaces: search }) })
  const view: RecordingView = {
    recording,
    file: undefined,
    tuneId: null,
    tuneTitle: null,
    holdsSplitAudio: false,
  }
  // Every write the editor starts, so a test can wait for all of them before it reads.
  const writes: Promise<void>[] = []
  function Host() {
    const [open, setOpen] = useState(true)
    return (
      <LocationEditor
        view={view}
        isOpen={open}
        onOpenChange={setOpen}
        run={(save) => void writes.push(save())}
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
  await expect.element(editor()).toBeVisible()
  /** Waits for every write the editor started, then says how many it started. */
  const settledWrites = async () => {
    await Promise.all(writes)
    return writes.length
  }
  return { analytics, search, seen: fake?.seen ?? null, releaseDevice, settledWrites }
}

const editor = () => page.getByRole('dialog', { name: LOCATION_LABEL })
const searchBox = () => editor().getByRole('searchbox', { name: FIND_A_PLACE })
const row = (name: string) => page.getByRole('button', { name, exact: true })
const section = (name: string) => editor().getByRole('region', { name })
const done = async () => {
  await editor().getByRole('button', { name: DONE, exact: true }).click()
  await expect.element(editor()).not.toBeInTheDocument()
}

/** Types into the search with timers faked, then lets the typing settle, so it searches. */
async function searchFor(text: string) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  fillStill(searchBox(), text)
  act(() => vi.advanceTimersByTime(SETTLE_MS))
  vi.useRealTimers()
}

/** The names of the dialog's shown buttons in order, the footer's Done and Cancel left out. */
const buttonNames = () =>
  [...editor().element().querySelectorAll('button')]
    .filter((button) => button.closest('[hidden]') === null)
    .map((button) => button.getAttribute('aria-label') ?? button.textContent ?? '')
    .filter((name) => name !== DONE && name !== CANCEL)

it('puts search first and labels it for new places', async () => {
  await setup()
  const first = editor().element().querySelector('input, button, a[href]')
  expect(first).toBe(searchBox().element())
  await expect.element(searchBox()).toHaveAttribute('placeholder', FIND_A_PLACE)
})

it('searches near the recording', async () => {
  const { search } = await setup()
  await searchFor('jalopy')
  await expect.poll(() => search.mock.calls).toEqual([['jalopy', SPOT]])
})

it('searches near the device for a recording with no place', async () => {
  const { search } = await setup({
    recording: recordingRow('r1'),
    permission: 'granted',
    device: { ...DEVICE, accuracy: 8 },
  })
  await searchFor('jalopy')
  // The device answers after the editor opens, and the search ranks near it.
  await expect.poll(() => search.mock.calls.at(-1)).toEqual(['jalopy', DEVICE])
})

it('Use current location sets a device place on dismissal', async () => {
  const { analytics, settledWrites } = await setup({
    recording: recordingRow('r1', { label: 'Fast version' }),
    permission: 'granted',
    device: { ...DEVICE, accuracy: 8 },
  })
  await row(USE_CURRENT_LOCATION).click()
  await expect.element(section(CURRENT_LOCATION)).toBeVisible()
  expect(await settledWrites()).toBe(0)
  await done()
  await expect.poll(async () => (await db.recordings.get('r1'))?.place_origin).toBe('device')
  expect(await db.recordings.get('r1')).toMatchObject({
    place_lat: DEVICE.lat,
    place_lon: DEVICE.lon,
    place_accuracy_m: 8,
    place_name: null,
    place_id: null,
  })
  await expect
    .poll(() => analytics.sends())
    .toContainEqual({
      name: 'recording_place_set',
      props: { method: 'current_location', recording_id: 'r1', replaced: false },
    })
})

it('Use current location says so when there is no fix, and clears on the next press', async () => {
  const { releaseDevice, settledWrites } = await setup({
    recording: recordingRow('r1'),
    permission: 'granted',
    device: null,
  })
  await row(USE_CURRENT_LOCATION).click()
  await expect.element(editor().getByText(NO_CURRENT_LOCATION)).toBeVisible()
  await expect.element(row(USE_CURRENT_LOCATION)).toBeEnabled()
  expect(await settledWrites()).toBe(0)
  releaseDevice.answerWith({ ...DEVICE, accuracy: 8 })
  await row(USE_CURRENT_LOCATION).click()
  await expect.element(section(CURRENT_LOCATION)).toBeVisible()
  await expect.element(editor().getByText(NO_CURRENT_LOCATION)).not.toBeInTheDocument()
})

it('Use current location links a saved location the device is at', async () => {
  await setup({
    places: [placeRow('p1', 'The barn', north(10))],
    permission: 'granted',
    device: { ...north(5), accuracy: 8 },
  })
  await row(USE_CURRENT_LOCATION).click()
  await expect.element(section(CURRENT_LOCATION).getByText('The barn')).toBeVisible()
  await done()
  await expect.poll(async () => (await db.recordings.get('r1'))?.place_id).toBe('p1')
  expect(await db.recordings.get('r1')).toMatchObject({ place_origin: 'device', place_name: null })
})

it('Use current location links a saved location made while the fix is pending', async () => {
  const { releaseDevice } = await setup({
    permission: 'granted',
    device: { ...north(5), accuracy: 8 },
    holdDevice: true,
  })
  await row(USE_CURRENT_LOCATION).click()
  await db.places.put(placeRow('p1', 'The barn', north(10)))
  releaseDevice()
  await expect.element(section(CURRENT_LOCATION).getByText('The barn')).toBeVisible()
})

it('access off: current location is inert, Nearby empty, opens on Saved', async () => {
  const { seen } = await setup({
    recording: recordingRow('r1'),
    places: [placeRow('p1', 'The barn')],
    permission: 'denied',
    mapkit: {},
  })
  await expect.element(row(USE_CURRENT_LOCATION)).toBeDisabled()
  await expect.element(editor().getByText(LOCATION_ACCESS_OFF)).toBeVisible()
  await expect.element(editor().getByRole('radio', { name: SAVED_LOCATIONS })).toBeChecked()
  await expect.element(row(pickLocationName('The barn'))).toBeVisible()
  await editor().getByRole('radio', { name: NEARBY_LOCATIONS }).click()
  await expect.element(editor().getByRole('radio', { name: NEARBY_LOCATIONS })).toBeChecked()
  await expect.element(row(pickLocationName('The barn'))).not.toBeInTheDocument()
  await expect.poll(() => seen!.searches).toEqual([])
})

it("opens on Nearby while the device's fix is read, and stays there once it lands", async () => {
  const { releaseDevice, seen } = await setup({
    recording: recordingRow('r1'),
    places: [placeRow('p1', 'The barn')],
    permission: 'granted',
    device: { ...DEVICE, accuracy: 8 },
    holdDevice: true,
    mapkit: {},
  })
  const nearby = editor().getByRole('radio', { name: NEARBY_LOCATIONS })
  await expect.element(nearby).toBeChecked()
  releaseDevice()
  await expect.poll(() => seen!.searches.length).toBeGreaterThan(0)
  await expect.element(nearby).toBeChecked()
})

it('falls to Saved when the device gives no fix', async () => {
  await setup({
    recording: recordingRow('r1'),
    places: [placeRow('p1', 'The barn')],
    permission: 'granted',
    device: null,
  })
  await expect.element(editor().getByRole('radio', { name: SAVED_LOCATIONS })).toBeChecked()
  await expect.element(row(pickLocationName('The barn'))).toBeVisible()
})

it('keeps the list it opened on when a fix arrives after location access turns on', async () => {
  await setup({
    recording: recordingRow('r1'),
    places: [placeRow('p1', 'The barn', DEVICE)],
    permission: 'prompt',
    device: { ...DEVICE, accuracy: 8 },
  })
  const saved = editor().getByRole('radio', { name: SAVED_LOCATIONS })
  await expect.element(saved).toBeChecked()
  fakeLocationPermissionForTest('granted')
  // A saved match shows its distance once the fix is the center.
  await searchFor('barn')
  await expect.element(editor().getByText('10 ft', { exact: true })).toBeVisible()
  await searchBox().clear()
  await expect.element(saved).toBeChecked()
})

it('keeps the chosen list across a search', async () => {
  await setup({ places: [placeRow('p1', 'The barn')] })
  await editor().getByRole('radio', { name: RECENT_LOCATIONS }).click()
  await searchFor('barn')
  await searchBox().clear()
  await expect.element(editor().getByRole('radio', { name: RECENT_LOCATIONS })).toBeChecked()
})

it('Nearby rows show distance from the recording', async () => {
  const venue = north(12)
  await setup({
    mapkit: {
      places: [
        {
          id: 'v1',
          name: 'Rex Theater',
          coordinate: { latitude: venue.lat, longitude: venue.lon },
        },
      ],
    },
  })
  await expect.element(editor().getByRole('radio', { name: NEARBY_LOCATIONS })).toBeChecked()
  const rex = row(pickLocationName('Rex Theater'))
  await expect.element(rex).toBeVisible()
  await expect.element(rex.getByText('40 ft', { exact: true })).toBeVisible()
})

it('search results show distance, and replace the rest of the editor', async () => {
  await setup({ searchPlaces: async () => ({ kind: 'ok', results: [JALOPY] }) })
  await expect.element(row(USE_CURRENT_LOCATION)).toBeVisible()
  await searchFor('jalopy')
  const jalopy = row(pickLocationName(JALOPY.title, JALOPY.subtitle))
  await expect.element(jalopy).toBeVisible()
  await expect.element(jalopy.getByText('2.2 mi', { exact: true })).toBeVisible()
  await expect.element(row(USE_CURRENT_LOCATION)).not.toBeInTheDocument()
  await expect
    .element(editor().getByRole('radio', { name: NEARBY_LOCATIONS }))
    .not.toBeInTheDocument()
})

it('keeps the map and the Nearby answer while a search shows', async () => {
  const venue = north(12)
  const { seen } = await setup({
    mapkit: {
      places: [
        {
          id: 'v1',
          name: 'Rex Theater',
          coordinate: { latitude: venue.lat, longitude: venue.lon },
        },
      ],
    },
  })
  const rex = row(pickLocationName('Rex Theater'))
  await expect.element(rex).toBeVisible()
  await expect.poll(() => seen!.maps.length).toBe(1)
  await searchFor('jalopy')
  await expect.element(rex).not.toBeInTheDocument()
  await searchBox().clear()
  await expect.element(rex).toBeVisible()
  expect(seen!.maps).toHaveLength(1)
  expect(seen!.maps[0]!.destroyed).toBe(false)
  expect(seen!.searches).toHaveLength(1)
})

it('matching saved locations show under search results', async () => {
  await setup({
    places: [placeRow('p1', 'The Barn', north(40)), placeRow('p2', 'Grange hall', north(60))],
    searchPlaces: async () => ({ kind: 'ok', results: [JALOPY] }),
  })
  await searchFor('barn')
  const saved = section(SAVED_LOCATIONS)
  await expect
    .element(saved.getByRole('button', { name: pickLocationName('The Barn') }))
    .toBeVisible()
  await expect
    .element(saved.getByRole('button', { name: pickLocationName('Grange hall') }))
    .not.toBeInTheDocument()
  await expect
    .poll(() => buttonNames().slice(1))
    .toEqual([
      pickLocationName(JALOPY.title, JALOPY.subtitle),
      pickLocationName('The Barn'),
      PIN_ROW,
    ])
  await saved.getByRole('button', { name: pickLocationName('The Barn') }).click()
  await expect.element(section(CURRENT_LOCATION).getByText('The Barn')).toBeVisible()
  await done()
  await expect.poll(async () => (await db.recordings.get('r1'))?.place_id).toBe('p1')
})

it('every search ends with the pin row, and so does an empty search', async () => {
  let results: PlaceResult[] = [JALOPY]
  await setup({ searchPlaces: async () => ({ kind: 'ok', results }) })
  await searchFor('jalopy')
  await expect.element(row(pickLocationName(JALOPY.title, JALOPY.subtitle))).toBeVisible()
  await expect.element(row(PIN_ROW)).toBeVisible()
  await expect.poll(() => buttonNames().at(-1)).toBe(PIN_ROW)
  results = []
  await searchFor('nowhere at all')
  await expect.element(editor().getByText(NO_LOCATIONS_FOUND)).toBeVisible()
  await expect.element(row(PIN_ROW)).toBeVisible()
  await expect.poll(() => buttonNames().at(-1)).toBe(PIN_ROW)
})

it('escape after a pick writes nothing and creates no saved location', async () => {
  const { analytics, settledWrites } = await setup({
    searchPlaces: async () => ({ kind: 'ok', results: [JALOPY] }),
  })
  await searchFor('jalopy')
  await row(pickLocationName(JALOPY.title, JALOPY.subtitle)).click()
  await expect.element(section(CURRENT_LOCATION).getByText(JALOPY.name)).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(editor()).not.toBeInTheDocument()
  // The editor is gone, so any write it would start has started.
  expect(await settledWrites()).toBe(0)
  expect(await db.places.count()).toBe(0)
  expect(await db.recordings.get('r1')).toMatchObject({ place_name: STREET, place_id: null })
  expect(analytics.sends()).toEqual([])
})

it('Cancel after a pick writes nothing and creates no saved location', async () => {
  const { analytics, settledWrites } = await setup({
    searchPlaces: async () => ({ kind: 'ok', results: [JALOPY] }),
  })
  await searchFor('jalopy')
  await row(pickLocationName(JALOPY.title, JALOPY.subtitle)).click()
  await expect.element(section(CURRENT_LOCATION).getByText(JALOPY.name)).toBeVisible()
  await editor().getByRole('button', { name: CANCEL, exact: true }).click()
  await expect.element(editor()).not.toBeInTheDocument()
  expect(await settledWrites()).toBe(0)
  expect(await db.places.count()).toBe(0)
  expect(await db.recordings.get('r1')).toMatchObject({ place_name: STREET, place_id: null })
  expect(analytics.sends()).toEqual([])
})

it('Cancel on the naming step keeps nothing and returns to the editor', async () => {
  const { analytics, settledWrites } = await setup()
  await row(NAME_THIS_LOCATION).click()
  const naming = page.getByRole('dialog', { name: NAME_LOCATION_TITLE })
  await naming.getByRole('textbox', { name: LOCATION_NAME_LABEL }).fill('Tom’s kitchen')
  await naming.getByRole('button', { name: CANCEL, exact: true }).click()
  await expect.element(section(CURRENT_LOCATION).getByText(STREET)).toBeVisible()
  await done()
  expect(await settledWrites()).toBe(0)
  expect(await db.places.count()).toBe(0)
  expect(analytics.sends()).toEqual([])
})

it('a search pick saves on dismissal, with the saved location it makes', async () => {
  const { analytics } = await setup({
    searchPlaces: async () => ({ kind: 'ok', results: [JALOPY] }),
  })
  await searchFor('jalopy')
  await row(pickLocationName(JALOPY.title, JALOPY.subtitle)).click()
  await expect.element(searchBox()).toHaveValue('')
  await done()
  await expect.poll(() => db.places.count()).toBe(1)
  expect(await db.recordings.get('r1')).toMatchObject({
    place_name: JALOPY.name,
    place_lat: JALOPY.lat,
    place_accuracy_m: null,
  })
  await expect
    .poll(() => analytics.sends())
    .toEqual([
      {
        name: 'recording_place_set',
        props: { method: 'search', recording_id: 'r1', replaced: true },
      },
      { name: 'saved_location_created', props: { method: 'search' } },
    ])
})

it('names this location: a saved location at the recording, linked on dismissal', async () => {
  const { analytics } = await setup()
  await row(NAME_THIS_LOCATION).click()
  const naming = page.getByRole('dialog', { name: NAME_LOCATION_TITLE })
  const name = naming.getByRole('textbox', { name: LOCATION_NAME_LABEL })
  await expect.element(name).toHaveFocus()
  await name.fill('Tom’s kitchen')
  await userEvent.keyboard('{Enter}')
  await expect.element(section(CURRENT_LOCATION).getByText('Tom’s kitchen')).toBeVisible()
  expect(await db.places.count()).toBe(0)
  await done()
  await expect.poll(() => db.places.count()).toBe(1)
  const [place] = await db.places.toArray()
  expect(place).toMatchObject({ name: 'Tom’s kitchen', address: STREET, ...SPOT })
  expect(await db.recordings.get('r1')).toMatchObject({ place_id: place!.id, place_name: STREET })
  expect(analytics.sends()).toContainEqual({
    name: 'saved_location_created',
    props: { method: 'custom' },
  })
})

it('Done on the naming step names the location with the name typed', async () => {
  const { analytics, settledWrites } = await setup()
  await row(NAME_THIS_LOCATION).click()
  const naming = page.getByRole('dialog', { name: NAME_LOCATION_TITLE })
  await naming.getByRole('textbox', { name: LOCATION_NAME_LABEL }).fill('Tom’s kitchen')
  await naming.getByRole('button', { name: DONE, exact: true }).click()
  await expect.element(naming).not.toBeInTheDocument()
  expect(await settledWrites()).toBe(1)
  const [place] = await db.places.toArray()
  expect(place).toMatchObject({ name: 'Tom’s kitchen', address: STREET, ...SPOT })
  expect(await db.recordings.get('r1')).toMatchObject({ place_id: place!.id })
  expect(analytics.sends()).toContainEqual({
    name: 'saved_location_created',
    props: { method: 'custom' },
  })
})

it('Done right after Enter on the naming step names the location once', async () => {
  const { settledWrites } = await setup()
  await row(NAME_THIS_LOCATION).click()
  const naming = page.getByRole('dialog', { name: NAME_LOCATION_TITLE })
  await naming.getByRole('textbox', { name: LOCATION_NAME_LABEL }).fill('Tom’s kitchen')
  await userEvent.keyboard('{Enter}')
  await editor().getByRole('button', { name: DONE, exact: true }).click()
  await expect.element(editor()).not.toBeInTheDocument()
  expect(await settledWrites()).toBe(1)
  expect(await db.places.toArray()).toMatchObject([{ name: 'Tom’s kitchen' }])
})

it('Done on the naming step with no name typed names nothing', async () => {
  const { settledWrites } = await setup()
  await row(NAME_THIS_LOCATION).click()
  const naming = page.getByRole('dialog', { name: NAME_LOCATION_TITLE })
  await naming.getByRole('textbox', { name: LOCATION_NAME_LABEL }).fill('  ')
  await naming.getByRole('button', { name: DONE, exact: true }).click()
  await expect.element(naming).not.toBeInTheDocument()
  expect(await settledWrites()).toBe(0)
  expect(await db.places.count()).toBe(0)
})

it('Escape on the naming step drops the name typed', async () => {
  const { analytics, settledWrites } = await setup()
  await row(NAME_THIS_LOCATION).click()
  const naming = page.getByRole('dialog', { name: NAME_LOCATION_TITLE })
  await naming.getByRole('textbox', { name: LOCATION_NAME_LABEL }).fill('Tom’s kitchen')
  await userEvent.keyboard('{Escape}')
  await expect.element(section(CURRENT_LOCATION).getByText(STREET)).toBeVisible()
  await done()
  expect(await settledWrites()).toBe(0)
  expect(await db.places.count()).toBe(0)
  expect(analytics.sends()).toEqual([])
})

it('opens Apple Maps at the recording’s point', async () => {
  const { analytics } = await setup()
  const link = editor().getByRole('link', { name: OPEN_IN_MAPS })
  await expect.element(link).toHaveAttribute('href', mapsUrl(SPOT, STREET))
  await expect.element(link).toHaveAttribute('target', '_blank')
  // Kept from opening a tab, which the test browser would leave behind.
  link.element().addEventListener('click', (event) => event.preventDefault(), { once: true })
  await link.click()
  await expect
    .poll(() => analytics.sends())
    .toEqual([{ name: 'location_opened_in_maps', props: {} }])
})

it('clears the location, and writes it on dismissal', async () => {
  const { analytics } = await setup()
  await section(CURRENT_LOCATION).getByRole('button', { name: CLEAR_LOCATION }).click()
  await expect.element(section(CURRENT_LOCATION)).not.toBeInTheDocument()
  await done()
  await expect.poll(async () => (await db.recordings.get('r1'))?.place_lat).toBeNull()
  await expect
    .poll(() => analytics.sends())
    .toEqual([{ name: 'recording_place_cleared', props: { recording_id: 'r1' } }])
})

/** A recording linked to a saved location, with no point of its own. */
const linkedOnly = () =>
  recordingRow('r1', { label: 'Fast version', place_id: 'p1', place_origin: 'picked' })
const BARN = placeRow('p1', 'The barn', { ...DEVICE, address: '12 Mill Rd, Galax, VA' })

it('shows a linked recording with no point of its own at its saved location', async () => {
  const { seen } = await setup({ recording: linkedOnly(), places: [BARN], mapkit: {} })
  const current = section(CURRENT_LOCATION)
  await expect.element(current.getByText('The barn')).toBeVisible()
  await expect.element(current.getByText('12 Mill Rd, Galax, VA')).toBeVisible()
  await expect
    .poll(() => seen!.maps.at(-1)?.region?.center)
    .toMatchObject({
      latitude: DEVICE.lat,
      longitude: DEVICE.lon,
    })
  await expect
    .element(current.getByRole('link', { name: OPEN_IN_MAPS }))
    .toHaveAttribute('href', mapsUrl(DEVICE, 'The barn'))
})

it('centers Nearby on the saved location of a linked recording with no point of its own', async () => {
  const shed = { lat: DEVICE.lat + 12 / M_PER_DEGREE, lon: DEVICE.lon }
  const { releaseDevice, seen } = await setup({
    recording: linkedOnly(),
    places: [BARN],
    permission: 'granted',
    device: { ...SPOT, accuracy: 8 },
    mapkit: {
      places: [
        { id: 'v1', name: 'The shed', coordinate: { latitude: shed.lat, longitude: shed.lon } },
      ],
    },
  })
  await expect.element(editor().getByRole('radio', { name: NEARBY_LOCATIONS })).toBeChecked()
  const venue = row(pickLocationName('The shed'))
  await expect.element(venue).toBeVisible()
  await expect.element(venue.getByText('40 ft', { exact: true })).toBeVisible()
  await expect
    .poll(() => seen!.searches.at(-1)?.center)
    .toMatchObject({ latitude: DEVICE.lat, longitude: DEVICE.lon })
  // Read once the distance and the search show the settled center, so a late read would count.
  expect(releaseDevice.reads()).toBe(0)
})

it('offers Name this location, not Rename, for a place that is not a saved location', async () => {
  await setup()
  await expect.element(row(NAME_THIS_LOCATION)).toBeVisible()
  await expect.element(row(RENAME_THIS_LOCATION)).not.toBeInTheDocument()
})

it.each([
  ['with no point of its own', linkedOnly()],
  ['with its own point', captured({ place_id: 'p1' })],
])('offers Rename, not Name, for a recording linked %s', async (_, recording) => {
  await setup({ recording, places: [BARN] })
  await expect.element(section(CURRENT_LOCATION).getByText('The barn')).toBeVisible()
  await expect.element(row(RENAME_THIS_LOCATION)).toBeVisible()
  await expect.element(row(NAME_THIS_LOCATION)).not.toBeInTheDocument()
})

it('offers Rename, not Name, once a saved location is picked', async () => {
  await setup({ places: [BARN] })
  await expect.element(row(NAME_THIS_LOCATION)).toBeVisible()
  await editor().getByRole('radio', { name: SAVED_LOCATIONS }).click()
  await row(pickLocationName('The barn', BARN.address)).click()
  await expect.element(section(CURRENT_LOCATION).getByText('The barn')).toBeVisible()
  await expect.element(row(RENAME_THIS_LOCATION)).toBeVisible()
  await expect.element(row(NAME_THIS_LOCATION)).not.toBeInTheDocument()
})

/** Renames the linked saved location through its step, and checks the step went back. */
async function renameTo(name: string) {
  await row(RENAME_THIS_LOCATION).click()
  const renaming = page.getByRole('dialog', { name: RENAME_THIS_LOCATION })
  const field = renaming.getByRole('textbox', { name: LOCATION_NAME_LABEL })
  await expect.element(field).toHaveValue('The barn')
  await expect.element(field).toHaveFocus()
  await field.fill(name)
  await userEvent.keyboard('{Enter}')
  await expect.element(section(CURRENT_LOCATION).getByText(name)).toBeVisible()
}

it('renames the saved location at once, keeping the link', async () => {
  const { analytics, settledWrites } = await setup({ recording: linkedOnly(), places: [BARN] })
  await renameTo('Back barn')
  await expect.poll(async () => (await db.places.get('p1'))?.name).toBe('Back barn')
  expect(await db.places.count()).toBe(1)
  expect(analytics.sends()).toEqual([{ name: 'saved_location_renamed', props: {} }])
  await done()
  // The rename is no pick of the editor's, so closing it writes nothing more.
  expect(await settledWrites()).toBe(0)
  expect(await db.recordings.get('r1')).toMatchObject({ place_id: 'p1' })
})

it('Escape on the editor after a rename keeps the new name', async () => {
  await setup({ recording: linkedOnly(), places: [BARN] })
  await renameTo('Back barn')
  await userEvent.keyboard('{Escape}')
  await expect.element(editor()).not.toBeInTheDocument()
  expect(await db.places.get('p1')).toMatchObject({ name: 'Back barn' })
})

it('Escape on the rename step cancels just the rename', async () => {
  const { analytics, settledWrites } = await setup({ recording: linkedOnly(), places: [BARN] })
  await row(RENAME_THIS_LOCATION).click()
  const renaming = page.getByRole('dialog', { name: RENAME_THIS_LOCATION })
  await renaming.getByRole('textbox', { name: LOCATION_NAME_LABEL }).fill('Back barn')
  await userEvent.keyboard('{Escape}')
  await expect.element(section(CURRENT_LOCATION).getByText('The barn')).toBeVisible()
  await done()
  expect(await settledWrites()).toBe(0)
  expect(await db.places.get('p1')).toMatchObject({ name: 'The barn' })
  expect(analytics.sends()).toEqual([])
})

it('Done on the rename step renames the saved location to the name typed', async () => {
  const { analytics, settledWrites } = await setup({ recording: linkedOnly(), places: [BARN] })
  await row(RENAME_THIS_LOCATION).click()
  const renaming = page.getByRole('dialog', { name: RENAME_THIS_LOCATION })
  await renaming.getByRole('textbox', { name: LOCATION_NAME_LABEL }).fill('Back barn')
  await renaming.getByRole('button', { name: DONE, exact: true }).click()
  await expect.element(renaming).not.toBeInTheDocument()
  expect(await settledWrites()).toBe(1)
  expect(await db.places.get('p1')).toMatchObject({ name: 'Back barn' })
  expect(await db.recordings.get('r1')).toMatchObject({ place_id: 'p1' })
  expect(analytics.sends()).toEqual([{ name: 'saved_location_renamed', props: {} }])
})

it('Done while an entered rename is still writing renames once', async () => {
  const { analytics, settledWrites } = await setup({ recording: linkedOnly(), places: [BARN] })
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  const get = db.places.get.bind(db.places)
  // Armed just before Enter, it holds the rename's own read of the place, after the read, so
  // Done lands while that rename is writing.
  let armed = false
  let holding = false
  const read = async (key: string) => {
    if (!armed || holding || key !== 'p1') return get(key)
    holding = true
    const place = await get(key)
    await held
    return place
  }
  vi.spyOn(db.places, 'get').mockImplementation(read as never)
  await row(RENAME_THIS_LOCATION).click()
  const renaming = page.getByRole('dialog', { name: RENAME_THIS_LOCATION })
  await renaming.getByRole('textbox', { name: LOCATION_NAME_LABEL }).fill('Back barn')
  armed = true
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => holding).toBe(true)
  await renaming.getByRole('button', { name: DONE, exact: true }).click()
  await expect.element(renaming).not.toBeInTheDocument()
  release()
  expect(await settledWrites()).toBe(1)
  expect(await db.places.get('p1')).toMatchObject({ name: 'Back barn' })
  expect(analytics.sends()).toEqual([{ name: 'saved_location_renamed', props: {} }])
})

it.each([
  ['empty', ''],
  ['unchanged', 'The barn '],
])('Done on the rename step with the name %s renames nothing', async (_, name) => {
  const { analytics, settledWrites } = await setup({ recording: linkedOnly(), places: [BARN] })
  await row(RENAME_THIS_LOCATION).click()
  const renaming = page.getByRole('dialog', { name: RENAME_THIS_LOCATION })
  await renaming.getByRole('textbox', { name: LOCATION_NAME_LABEL }).fill(name)
  await renaming.getByRole('button', { name: DONE, exact: true }).click()
  await expect.element(renaming).not.toBeInTheDocument()
  expect(await settledWrites()).toBe(0)
  expect(await db.places.get('p1')).toMatchObject({ name: 'The barn' })
  expect(analytics.sends()).toEqual([])
})

it('an empty name on the rename step says so under the field and writes nothing', async () => {
  const { analytics, settledWrites } = await setup({ recording: linkedOnly(), places: [BARN] })
  await row(RENAME_THIS_LOCATION).click()
  const renaming = page.getByRole('dialog', { name: RENAME_THIS_LOCATION })
  const field = renaming.getByRole('textbox', { name: LOCATION_NAME_LABEL })
  await field.fill('')
  await userEvent.keyboard('{Enter}')
  await expect.element(renaming.getByText(PLACE_NAME_REQUIRED, { exact: true })).toBeVisible()
  await expect.element(field).toBeVisible()
  expect(await db.places.get('p1')).toMatchObject({ name: 'The barn' })
  expect(analytics.sends()).toEqual([])
  await renaming.getByRole('button', { name: BACK, exact: true }).click()
  await done()
  expect(await settledWrites()).toBe(0)
})

it('Back from the rename keeps the name as it was', async () => {
  const { settledWrites } = await setup({ recording: linkedOnly(), places: [BARN] })
  await row(RENAME_THIS_LOCATION).click()
  const renaming = page.getByRole('dialog', { name: RENAME_THIS_LOCATION })
  await renaming.getByRole('textbox', { name: LOCATION_NAME_LABEL }).fill('Back barn')
  await renaming.getByRole('button', { name: BACK, exact: true }).click()
  await expect.element(section(CURRENT_LOCATION).getByText('The barn')).toBeVisible()
  await done()
  expect(await settledWrites()).toBe(0)
  expect(await db.places.get('p1')).toMatchObject({ name: 'The barn' })
})

it('clears a linked recording with no point of its own', async () => {
  const { analytics } = await setup({ recording: linkedOnly(), places: [BARN] })
  await section(CURRENT_LOCATION).getByRole('button', { name: CLEAR_LOCATION }).click()
  await expect.element(section(CURRENT_LOCATION)).not.toBeInTheDocument()
  await done()
  await expect.poll(async () => (await db.recordings.get('r1'))?.place_id).toBeNull()
  await expect
    .poll(() => analytics.sends())
    .toEqual([{ name: 'recording_place_cleared', props: { recording_id: 'r1' } }])
})

it('shows the map larger than the page’s, and keeps place names out of replay', async () => {
  const { seen } = await setup({ mapkit: {} })
  await expect.poll(() => seen!.maps.length).toBe(1)
  expect(seen!.maps[0]!.element.getBoundingClientRect().height).toBeGreaterThan(180)
  await expect.element(section(CURRENT_LOCATION).getByText(STREET)).toHaveClass(/ph-no-capture/)
})

it('Escape in a search holding text empties it, and the editor stays', async () => {
  await setup()
  await searchFor('jalopy')
  await userEvent.keyboard('{Escape}')
  await expect.element(searchBox()).toHaveValue('')
  await expect.element(editor()).toBeVisible()
  await expect.element(row(USE_CURRENT_LOCATION)).toBeVisible()
})

it('Back from naming returns to the editor with nothing named', async () => {
  const { settledWrites } = await setup()
  await row(NAME_THIS_LOCATION).click()
  const naming = page.getByRole('dialog', { name: NAME_LOCATION_TITLE })
  await naming.getByRole('textbox', { name: LOCATION_NAME_LABEL }).fill('Tom’s kitchen')
  await naming.getByRole('button', { name: BACK, exact: true }).click()
  await expect.element(searchBox()).toBeVisible()
  await expect.element(section(CURRENT_LOCATION).getByText(STREET)).toBeVisible()
  await done()
  // Done with nothing staged writes nothing.
  expect(await settledWrites()).toBe(0)
  expect(await db.places.count()).toBe(0)
})

it('Escape on the naming step goes back with the pick kept, and a second discards it', async () => {
  const { analytics, settledWrites } = await setup({
    searchPlaces: async () => ({ kind: 'ok', results: [JALOPY] }),
  })
  await searchFor('jalopy')
  await row(pickLocationName(JALOPY.title, JALOPY.subtitle)).click()
  await expect.element(section(CURRENT_LOCATION).getByText(JALOPY.name)).toBeVisible()
  await row(NAME_THIS_LOCATION).click()
  const naming = page.getByRole('dialog', { name: NAME_LOCATION_TITLE })
  await expect.element(naming.getByRole('textbox', { name: LOCATION_NAME_LABEL })).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(section(CURRENT_LOCATION).getByText(JALOPY.name)).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(editor()).not.toBeInTheDocument()
  // The editor is gone, so any write it would start has started.
  expect(await settledWrites()).toBe(0)
  expect(await db.places.count()).toBe(0)
  expect(await db.recordings.get('r1')).toMatchObject({ place_name: STREET })
  expect(analytics.sends()).toEqual([])
})

it('a fix that arrives after a later pick never replaces it', async () => {
  const { releaseDevice } = await setup({
    permission: 'granted',
    device: { ...DEVICE, accuracy: 8 },
    holdDevice: true,
    searchPlaces: async () => ({ kind: 'ok', results: [JALOPY] }),
  })
  await row(USE_CURRENT_LOCATION).click()
  await searchFor('jalopy')
  await row(pickLocationName(JALOPY.title, JALOPY.subtitle)).click()
  await expect.element(section(CURRENT_LOCATION).getByText(JALOPY.name)).toBeVisible()
  releaseDevice()
  await expect.element(row(USE_CURRENT_LOCATION)).toBeEnabled()
  await done()
  await expect.poll(async () => (await db.recordings.get('r1'))?.place_name).toBe(JALOPY.name)
  expect(await db.recordings.get('r1')).toMatchObject({ place_origin: 'picked' })
})

it('says the map is unavailable under the current location when MapKit cannot load', async () => {
  await setup({ recording: captured() })
  await expect.element(editor().getByText(MAP_UNAVAILABLE)).toBeVisible()
  await expect.element(searchBox()).toBeVisible()
  await expect.element(row(USE_CURRENT_LOCATION)).toBeVisible()
})

it('says the map needs a connection when the browser is offline', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  await setup({ recording: captured(), mapkit: {} })
  await expect.element(editor().getByText(MAP_NEEDS_CONNECTION)).toBeVisible()
  expect(editor().getByText(MAP_UNAVAILABLE).query()).toBeNull()
})

it('says nothing about the map while MapKit loads', async () => {
  await setup({ recording: captured(), mapkitLoading: true })
  await expect.element(searchBox()).toBeVisible()
  expect(editor().getByText(MAP_UNAVAILABLE).query()).toBeNull()
  expect(editor().getByText(MAP_NEEDS_CONNECTION).query()).toBeNull()
})
