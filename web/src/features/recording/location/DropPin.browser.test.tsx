import { act } from '@testing-library/react'
import { useState } from 'react'
import { page, userEvent } from 'vitest/browser'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { PlaceResult } from '../../../api/types'
import type { CrosstuneDb } from '../../../db/schema'
import type { LocalRecording } from '../../../db/types'
import type { MapKit } from '../../../platform/mapkit'
import { MapKitContext } from '../../../platform/useMapKit'
import type { PlaceReverseOutcome, PlaceSearchOutcome } from '../../../sync/types'
import { openTestDb } from '../../../test/db'
import { fakeLocationPermissionForTest } from '../../../test/fakeLocationPermission'
import { MAP_NEEDS_CONNECTION, MAP_UNAVAILABLE } from '../../../ui/LocationMap'
import { fakeMapKit } from '../../../test/fakeMapKit'
import { dataProviders, fakeEngine } from '../../../test/providers'
import { renderWithProviders } from '../../../test/render'
import { placeRow, recordingRow } from '../../../test/rows'
import { elementStill, fillStill, pollStill } from '../../../test/stillPoll'
import { BACK, DONE } from '../../../ui/confirmCopy'
import { SHEET } from '../../../ui/sheetGeometry'
import { SETTLE_MS } from '../../../ui/useSettled'
import { recordingAnalytics } from '../../../usage/testing'
import {
  LOCATION_LABEL,
  LOCATION_NAME_LABEL,
  LOCATION_SEARCH_OFFLINE,
  LOCATION_SEARCH_UNAVAILABLE,
  locationSearchBusy,
  NO_LOCATIONS_FOUND,
  pickLocationName,
} from '../../recordings/recordingsCopy'
import type { RecordingView } from '../../recordings/useRecordings'
import { LocationEditor } from './LocationEditor'
import {
  CANT_FIND_IT,
  DROP_A_PIN,
  FIND_A_PLACE,
  MOVE_THE_MAP,
  USE_CURRENT_LOCATION,
  USE_THIS_SPOT,
} from './locationEditorCopy'

const STREET = '200 Eastern Pkwy, Brooklyn, NY'
const SPOT = { lat: 40.6718, lon: -73.9635 }
const OTHER = { lat: 40.6845, lon: -74.0019 }
const OTHER_NAME = '315 Columbia St, Brooklyn, NY'
const OTHER_ADDRESS = '315 Columbia St, Brooklyn, NY 11231, United States'
const SPOT_NAME = '200 Eastern Pkwy, Brooklyn, NY'
const PIN_ROW = `${CANT_FIND_IT} ${DROP_A_PIN}`

let db: CrosstuneDb
/** The maps this test's MapKit has drawn. */
let maps: ReturnType<typeof fakeMapKit>['seen']['maps'] = []

beforeEach(() => {
  db = openTestDb()
})

afterEach(() => {
  vi.useRealTimers()
})

const placed = () =>
  recordingRow('r1', {
    label: 'Fast version',
    place_name: STREET,
    place_lat: SPOT.lat,
    place_lon: SPOT.lon,
    place_accuracy_m: 12,
    place_origin: 'device',
  })

/** Names each point the way the reverse endpoint would. */
async function named(lat: number, lon: number): Promise<PlaceReverseOutcome> {
  if (lat === OTHER.lat && lon === OTHER.lon) {
    return { kind: 'ok', place: { name: OTHER_NAME, address: OTHER_ADDRESS, lat, lon } }
  }
  return { kind: 'ok', place: { name: SPOT_NAME, address: null, lat, lon } }
}

async function setup({
  recording = placed(),
  others = [],
  reversePlace = named,
  searchPlaces = async () => ({ kind: 'ok', results: [] }),
  density = 'pointer',
  mapkitLoad = 'loads',
}: {
  recording?: LocalRecording
  /** More recordings in the library. */
  others?: LocalRecording[]
  reversePlace?: (lat: number, lon: number) => Promise<PlaceReverseOutcome>
  searchPlaces?: (q: string) => Promise<PlaceSearchOutcome>
  density?: 'touch' | 'pointer'
  /** How MapKit's load ends: with MapKit, with nothing, or never. */
  mapkitLoad?: 'loads' | 'fails' | 'never'
} = {}) {
  fakeLocationPermissionForTest('unknown')
  await db.recordings.bulkPut([recording, ...others])
  const analytics = recordingAnalytics()
  const fake = fakeMapKit()
  maps = fake.seen.maps
  const load = vi.fn((): Promise<MapKit | null> =>
    mapkitLoad === 'never'
      ? new Promise(() => {})
      : Promise.resolve(mapkitLoad === 'fails' ? null : fake.mapkit),
  )
  const reverse = vi.fn(reversePlace)
  const engine = fakeEngine({ reversePlace: reverse, searchPlaces })
  const Data = dataProviders({ db, analytics, engine })
  // Every write the editor starts, so a test can wait for all of them before it reads.
  const writes: Promise<void>[] = []
  const view: RecordingView = {
    recording,
    file: undefined,
    tuneId: null,
    tuneTitle: null,
    holdsSplitAudio: false,
  }
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
    { density },
  )
  await expect.element(editor()).toBeVisible()
  /** Waits for every write the editor started, then says how many it started. */
  const settledWrites = async () => {
    await Promise.all(writes)
    return writes.length
  }
  /** Moves the pin map as a drag does and lets it settle, so the spot is looked up. */
  const moveTo = (lat: number, lon: number) =>
    whileSettling(() => act(() => fake.moveMap(lat, lon)))
  return { analytics, reverse, seen: fake.seen, moveMap: fake.moveMap, moveTo, settledWrites }
}

const editor = () => page.getByRole('dialog', { name: LOCATION_LABEL })
const searchBox = () => editor().getByRole('searchbox', { name: FIND_A_PLACE })
const row = (name: string) => page.getByRole('button', { name, exact: true })
const spotButton = () => editor().getByRole('button', { name: USE_THIS_SPOT, exact: true })
const nameField = () => editor().getByRole('textbox', { name: LOCATION_NAME_LABEL })
const done = async () => {
  await editor().getByRole('button', { name: DONE, exact: true }).click()
  await expect.element(editor()).not.toBeInTheDocument()
}

/** Runs `run` with timers faked, then lets the settle time pass, so a lookup it held runs. */
async function whileSettling(run: () => unknown) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  await run()
  act(() => vi.advanceTimersByTime(SETTLE_MS))
  vi.useRealTimers()
}

/** Types into the search and lets the typing settle, so it searches. */
async function searchFor(text: string) {
  await whileSettling(() => fillStill(searchBox(), text))
}

/** Opens the pin drop from the row that ends a search, and lets its start be looked up. One
 * letter runs no search. */
async function dropPin(query = 'x', { drawsMap = true } = {}) {
  await searchBox().fill(query)
  // The recording's own map may be drawn already; the pin map is the next one.
  const before = maps.length
  await whileSettling(async () => {
    await row(PIN_ROW).click()
    await elementStill(spotButton()).toBeVisible()
    if (drawsMap) await pollStill(() => maps.length).toBe(before + 1)
  })
}

/** The center of the pin map's first region. */
const startedAt = (seen: ReturnType<typeof fakeMapKit>['seen']) => {
  const center = seen.maps.at(-1)?.region?.center
  return center ? { lat: center.latitude, lon: center.longitude } : null
}

const COLUMBIA: PlaceResult = {
  name: OTHER_NAME,
  ...OTHER,
  title: '315 Columbia St',
  subtitle: 'Brooklyn, NY',
  kind: 'address',
}

it.each([
  ['a search with no results', [], () => editor().getByText(NO_LOCATIONS_FOUND)],
  [
    'the end of a result list',
    [COLUMBIA],
    () => row(pickLocationName(COLUMBIA.title, COLUMBIA.subtitle)),
  ],
] as const)(
  'reaches the pin map from %s, moves it, and Use this spot writes the spot',
  async (_, results, answer) => {
    const { seen, moveTo } = await setup({
      searchPlaces: async () => ({ kind: 'ok', results: [...results] }),
    })
    await searchFor('columbia')
    await expect.element(answer()).toBeVisible()
    const before = seen.maps.length
    await whileSettling(async () => {
      await row(PIN_ROW).click()
      await pollStill(() => seen.maps.length).toBe(before + 1)
    })
    const pinMap = seen.maps.at(-1)!
    expect(pinMap.options).not.toHaveProperty('isScrollEnabled', false)
    await expect.element(editor().getByRole('status').getByText(SPOT_NAME)).toBeVisible()
    await moveTo(OTHER.lat, OTHER.lon)
    await expect.element(editor().getByRole('status').getByText(OTHER_NAME)).toBeVisible()
    await spotButton().click()
    await done()
    await expect.poll(async () => (await db.recordings.get('r1'))?.place_lat).toBe(OTHER.lat)
    expect(await db.recordings.get('r1')).toMatchObject({
      place_name: OTHER_NAME,
      place_lon: OTHER.lon,
      place_origin: 'picked',
    })
  },
)

it('on touch, raises the sheet so the whole pin drop shows, and lowers it on Back', async () => {
  await setup({ density: 'touch' })
  const top = () => editor().element().getBoundingClientRect().top
  const partTop = window.innerHeight * (1 - SHEET.partRatio)
  // Within a pixel, since the sheet's offset is fractional.
  const atPart = () => Math.abs(top() - partTop) <= 1
  await expect.poll(atPart).toBe(true)
  await dropPin()
  // Settled within the window, the map, the address under the pin, and Use this spot all show.
  await expect
    .poll(() => spotButton().element().getBoundingClientRect().bottom)
    .toBeLessThanOrEqual(window.innerHeight)
  await editor().getByRole('button', { name: BACK, exact: true }).click()
  await expect.poll(atPart).toBe(true)
})

it('shows the address under the pin once the map settles', async () => {
  const { reverse, seen, moveTo } = await setup()
  await dropPin()
  await expect.poll(() => startedAt(seen)).toEqual(SPOT)
  await expect.element(editor().getByText(MOVE_THE_MAP)).toBeVisible()
  await expect.element(editor().getByText(SPOT_NAME)).toBeVisible()
  await moveTo(OTHER.lat, OTHER.lon)
  await expect.element(editor().getByText(OTHER_NAME)).toBeVisible()
  await expect.element(editor().getByText(SPOT_NAME)).not.toBeInTheDocument()
  await expect.element(editor().getByText(OTHER_NAME)).toHaveClass(/ph-no-capture/)
  expect(reverse.mock.calls).toEqual([
    [SPOT.lat, SPOT.lon],
    [OTHER.lat, OTHER.lon],
  ])
})

it('looks up the spot only once the map has settled for the settle time', async () => {
  const { reverse, moveMap } = await setup()
  await dropPin()
  await expect.poll(() => reverse.mock.calls).toEqual([[SPOT.lat, SPOT.lon]])
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  // A drag still under way has not settled.
  act(() => moveMap(OTHER.lat, OTHER.lon, { settle: false }))
  act(() => vi.advanceTimersByTime(1000))
  expect(reverse).toHaveBeenCalledTimes(1)
  act(() => moveMap(OTHER.lat, OTHER.lon))
  act(() => vi.advanceTimersByTime(SETTLE_MS - 1))
  expect(reverse).toHaveBeenCalledTimes(1)
  act(() => vi.advanceTimersByTime(1))
  await pollStill(() => reverse.mock.calls.at(-1)).toEqual([OTHER.lat, OTHER.lon])
})

it('looks up a spot once while the editor is open, however often the pin drop opens there', async () => {
  const { reverse } = await setup()
  await dropPin()
  await expect.element(editor().getByText(SPOT_NAME)).toBeVisible()
  await editor().getByRole('button', { name: BACK, exact: true }).click()
  await dropPin()
  await expect.element(editor().getByText(SPOT_NAME)).toBeVisible()
  expect(reverse.mock.calls).toEqual([[SPOT.lat, SPOT.lon]])
})

it('asks again for a spot whose lookup could not answer', async () => {
  const { reverse } = await setup({ reversePlace: async () => ({ kind: 'offline' }) })
  await dropPin()
  await expect.element(editor().getByText(LOCATION_SEARCH_OFFLINE)).toBeVisible()
  await editor().getByRole('button', { name: BACK, exact: true }).click()
  await dropPin()
  await expect.poll(() => reverse.mock.calls.length).toBe(2)
})

it('Use this spot stages the place and saves on dismissal', async () => {
  const { analytics, moveTo } = await setup()
  await dropPin()
  await moveTo(OTHER.lat, OTHER.lon)
  await expect.element(editor().getByText(OTHER_NAME)).toBeVisible()
  await spotButton().click()
  await expect.element(searchBox()).toBeVisible()
  await expect.element(editor().getByText(OTHER_NAME)).toBeVisible()
  // Nothing is written until the editor closes.
  expect(await db.recordings.get('r1')).toMatchObject({ place_name: STREET })
  await done()
  await expect.poll(async () => (await db.recordings.get('r1'))?.place_name).toBe(OTHER_NAME)
  expect(await db.recordings.get('r1')).toMatchObject({
    place_lat: OTHER.lat,
    place_lon: OTHER.lon,
    place_accuracy_m: null,
    place_origin: 'picked',
    place_id: null,
  })
  expect(await db.places.count()).toBe(0)
  await expect
    .poll(() => analytics.sends())
    .toEqual([
      {
        name: 'recording_place_set',
        props: { method: 'pin', recording_id: 'r1', replaced: true },
      },
    ])
})

it('a typed name creates a saved location linked to the recording', async () => {
  const { analytics, moveTo } = await setup()
  await dropPin()
  await moveTo(OTHER.lat, OTHER.lon)
  await expect.element(editor().getByText(OTHER_NAME)).toBeVisible()
  await nameField().fill('Back room')
  await spotButton().click()
  await expect.element(searchBox()).toBeVisible()
  expect(await db.places.count()).toBe(0)
  await done()
  await expect.poll(() => db.places.count()).toBe(1)
  const [place] = await db.places.toArray()
  expect(place).toMatchObject({
    name: 'Back room',
    address: OTHER_ADDRESS,
    lat: OTHER.lat,
    lon: OTHER.lon,
  })
  expect(await db.recordings.get('r1')).toMatchObject({
    place_id: place!.id,
    place_name: OTHER_NAME,
    place_lat: OTHER.lat,
    place_lon: OTHER.lon,
    place_accuracy_m: null,
    place_origin: 'picked',
  })
  await expect
    .poll(() => analytics.sends())
    .toEqual([
      {
        name: 'recording_place_set',
        props: { method: 'pin', recording_id: 'r1', replaced: true },
      },
      { name: 'saved_location_created', props: { method: 'custom' } },
    ])
})

it('Enter in the name field uses the spot', async () => {
  await setup()
  await dropPin()
  await expect.element(editor().getByText(SPOT_NAME)).toBeVisible()
  await nameField().fill('Kitchen')
  await userEvent.keyboard('{Enter}')
  await expect.element(searchBox()).toBeVisible()
  await expect.element(editor().getByText('Kitchen')).toBeVisible()
})

it('escape after naming a pin writes nothing and creates no saved location', async () => {
  const { analytics, moveTo, settledWrites } = await setup()
  await dropPin()
  await moveTo(OTHER.lat, OTHER.lon)
  await expect.element(editor().getByText(OTHER_NAME)).toBeVisible()
  await nameField().fill('Back room')
  await spotButton().click()
  await expect.element(searchBox()).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(editor()).not.toBeInTheDocument()
  // The editor is gone, so any write it would start has started.
  expect(await settledWrites()).toBe(0)
  expect(await db.places.count()).toBe(0)
  expect(await db.recordings.get('r1')).toMatchObject({ place_name: STREET, place_id: null })
  expect(analytics.sends()).toEqual([])
})

it('Back returns to the editor with nothing staged', async () => {
  const { analytics, moveTo, seen, settledWrites } = await setup()
  await dropPin()
  await moveTo(OTHER.lat, OTHER.lon)
  await nameField().fill('Back room')
  const pinMap = seen.maps.at(-1)!
  await editor().getByRole('button', { name: BACK, exact: true }).click()
  await expect.poll(() => pinMap.destroyed).toBe(true)
  await expect.element(searchBox()).toHaveValue('x')
  await expect.element(row(PIN_ROW)).toBeVisible()
  await searchBox().clear()
  await expect.element(row(USE_CURRENT_LOCATION)).toBeVisible()
  await expect.element(editor().getByText(STREET)).toBeVisible()
  await done()
  expect(await settledWrites()).toBe(0)
  expect(await db.places.count()).toBe(0)
  expect(await db.recordings.get('r1')).toMatchObject({ place_name: STREET, place_lat: SPOT.lat })
  expect(analytics.sends()).toEqual([])
})

it('keeps the search and its results across the pin drop', async () => {
  const { seen } = await setup({
    searchPlaces: async () => ({
      kind: 'ok',
      results: [
        {
          name: OTHER_NAME,
          ...OTHER,
          title: '315 Columbia St',
          subtitle: 'Brooklyn, NY',
          kind: 'address',
        },
      ],
    }),
  })
  const result = row(pickLocationName('315 Columbia St', 'Brooklyn, NY'))
  await searchFor('columbia')
  await expect.element(result).toBeVisible()
  const before = seen.maps.length
  await row(PIN_ROW).click()
  await expect.element(spotButton()).toBeVisible()
  await expect.poll(() => seen.maps.length).toBe(before + 1)
  const pinMap = seen.maps.at(-1)!
  await editor().getByRole('button', { name: BACK, exact: true }).click()
  await expect.element(searchBox()).toHaveValue('columbia')
  await expect.element(result).toBeVisible()
  await expect.poll(() => pinMap.destroyed).toBe(true)
})

it('Escape on the pin drop steps back, and a second discards the editor', async () => {
  const { analytics, settledWrites } = await setup()
  await dropPin()
  await expect.element(editor().getByText(SPOT_NAME)).toBeVisible()
  await nameField().fill('Back room')
  await userEvent.keyboard('{Escape}')
  await expect.element(searchBox()).toBeVisible()
  await expect.element(spotButton()).not.toBeInTheDocument()
  await expect.element(searchBox()).toHaveValue('x')
  await expect.element(searchBox()).toHaveFocus()
  // The search holds its text, so Escape empties it before it discards the editor.
  await userEvent.keyboard('{Escape}')
  await expect.element(searchBox()).toHaveValue('')
  await userEvent.keyboard('{Escape}')
  await expect.element(editor()).not.toBeInTheDocument()
  expect(await settledWrites()).toBe(0)
  expect(await db.places.count()).toBe(0)
  expect(await db.recordings.get('r1')).toMatchObject({ place_name: STREET })
  expect(analytics.sends()).toEqual([])
})

it.each([
  ['not found', { kind: 'not_found' }, null],
  ['failed', { kind: 'failed' }, null],
  ['offline', { kind: 'offline' }, LOCATION_SEARCH_OFFLINE],
  ['unavailable', { kind: 'unavailable' }, LOCATION_SEARCH_UNAVAILABLE],
  ['rate limited', { kind: 'rate_limited', retryAfterSeconds: 12 }, locationSearchBusy(12)],
] as const)(
  'reverse lookup failure (%s) shows the coordinates’ area as unnamed and still allows Use this spot',
  async (_, outcome, message) => {
    const { reverse, analytics } = await setup({ reversePlace: async () => outcome })
    await dropPin()
    await expect.poll(() => reverse.mock.calls.length).toBe(1)
    const status = editor().getByRole('status')
    if (message) await expect.element(status).toHaveTextContent(message)
    // An outcome that reaches the screen has landed by the time the poll above saw the call.
    else await expect.poll(() => status.element().textContent).toBe('')
    await expect.element(spotButton()).toBeEnabled()
    await spotButton().click()
    await expect.element(searchBox()).toBeVisible()
    await done()
    // The server names a point that has none.
    await expect.poll(async () => (await db.recordings.get('r1'))?.place_origin).toBe('picked')
    expect(await db.recordings.get('r1')).toMatchObject({
      place_name: null,
      place_lat: SPOT.lat,
      place_lon: SPOT.lon,
      place_accuracy_m: null,
    })
    await expect
      .poll(() => analytics.sends())
      .toEqual([
        {
          name: 'recording_place_set',
          props: { method: 'pin', recording_id: 'r1', replaced: true },
        },
      ])
  },
)

it('starts at the area of the typed search for a recording with no point', async () => {
  const jalopy: PlaceResult = {
    name: 'Jalopy Theatre, 315 Columbia St, Brooklyn, NY',
    ...OTHER,
    title: 'Jalopy Theatre',
    subtitle: OTHER_NAME,
    kind: 'venue',
    address: OTHER_NAME,
  }
  const { seen } = await setup({
    recording: recordingRow('r1'),
    searchPlaces: async () => ({ kind: 'ok', results: [jalopy] }),
  })
  await searchFor('jalopy')
  await expect.element(row(pickLocationName(jalopy.title, jalopy.subtitle))).toBeVisible()
  await row(PIN_ROW).click()
  await expect.poll(() => startedAt(seen)).toEqual(OTHER)
})

it("starts again at the search's area after Back, with no second search", async () => {
  const jalopy: PlaceResult = {
    name: 'Jalopy Theatre, 315 Columbia St, Brooklyn, NY',
    ...OTHER,
    title: 'Jalopy Theatre',
    subtitle: OTHER_NAME,
    kind: 'venue',
    address: OTHER_NAME,
  }
  let asked = 0
  const { seen } = await setup({
    recording: recordingRow('r1'),
    searchPlaces: async () => {
      asked += 1
      return { kind: 'ok', results: [jalopy] }
    },
  })
  const result = row(pickLocationName(jalopy.title, jalopy.subtitle))
  await searchFor('jalopy')
  await expect.element(result).toBeVisible()
  await row(PIN_ROW).click()
  await expect.poll(() => startedAt(seen)).toEqual(OTHER)
  await editor().getByRole('button', { name: BACK, exact: true }).click()
  await expect.element(result).toBeVisible()
  expect(asked).toBe(1)
  const before = seen.maps.length
  await row(PIN_ROW).click()
  await expect.poll(() => seen.maps.length).toBe(before + 1)
  await expect.poll(() => startedAt(seen)).toEqual(OTHER)
})

it('starts at the latest recording with a place for a recording with no point', async () => {
  const latest = recordingRow('r0', {
    place_lat: OTHER.lat,
    place_lon: OTHER.lon,
    place_origin: 'device',
  })
  const { seen } = await setup({ recording: recordingRow('r1'), others: [latest] })
  await dropPin()
  await expect.poll(() => startedAt(seen)).toEqual(OTHER)
})

it("starts at the linked saved location's point for a recording with no point", async () => {
  await db.places.put(placeRow('p1', 'The barn', OTHER))
  const { seen } = await setup({
    recording: recordingRow('r1', { place_id: 'p1', place_origin: 'picked' }),
  })
  await dropPin()
  await expect.poll(() => startedAt(seen)).toEqual(OTHER)
})

it('shows the world with nowhere to start, and uses no spot until the map moves', async () => {
  const { seen, reverse, moveTo } = await setup({ recording: recordingRow('r1') })
  await dropPin()
  await expect
    .poll(() => (seen.maps.at(-1)?.region?.span as { latitudeDelta: number }).latitudeDelta)
    .toBeGreaterThanOrEqual(90)
  await expect.element(spotButton()).toBeDisabled()
  await moveTo(OTHER.lat, OTHER.lon)
  await expect.element(spotButton()).toBeEnabled()
  await expect.poll(() => reverse.mock.calls).toEqual([[OTHER.lat, OTHER.lon]])
})

it('says the map is unavailable when MapKit cannot load, and Use this spot waits for a point', async () => {
  await setup({ mapkitLoad: 'fails', recording: recordingRow('r1') })
  await dropPin('x', { drawsMap: false })
  await expect.element(editor().getByText(MAP_UNAVAILABLE)).toBeVisible()
  await expect.element(spotButton()).toBeDisabled()
})

it('says the map needs a connection when the browser is offline', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  await setup({ recording: recordingRow('r1') })
  await dropPin('x', { drawsMap: false })
  await expect.element(editor().getByText(MAP_NEEDS_CONNECTION)).toBeVisible()
  await expect.element(spotButton()).toBeDisabled()
})

it('says nothing about the map while MapKit loads', async () => {
  await setup({ mapkitLoad: 'never', recording: recordingRow('r1') })
  await dropPin('x', { drawsMap: false })
  await expect.element(spotButton()).toBeVisible()
  expect(editor().getByText(MAP_UNAVAILABLE).query()).toBeNull()
  expect(editor().getByText(MAP_NEEDS_CONNECTION).query()).toBeNull()
})
