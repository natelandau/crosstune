import { expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { recordingPath } from '../../layout/tuneHome'
import { recordedTime } from '../../text/format'
import { MapKitContext } from '../../platform/useMapKit'
import { openTestDb } from '../../test/db'
import { fakeMapKit, type FakeMapKitOptions } from '../../test/fakeMapKit'
import { PHONE, WIDE } from '../../test/practice'
import { fakePlaybackEngine } from '../../test/providers'
import { renderApp } from '../../test/renderApp'
import {
  entitlementRow,
  placeRow,
  recordingFile,
  recordingRow,
  tuneRow,
  userTuneRow,
} from '../../test/rows'
import { DONE } from '../../ui/confirmCopy'
import { NOT_SET } from '../../ui/fieldCopy'
import { MONTH_LABEL, MONTH_LABELS, YEAR_LABEL } from '../../ui/partialDate'
import { AnalyticsProvider } from '../../usage/AnalyticsProvider'
import { recordingAnalytics } from '../../usage/testing'
import { addTypedTitleLabel, SEARCH_TUNES } from '../catalog/catalogCopy'
import { RECORDING_NAME_LABEL, recordedAtNote } from '../recordings/recordingCopy'
import {
  addToTuneName,
  CLEAR_LOCATION,
  LOCATION_LABEL,
  LOCATION_NAME_LABEL,
  NAME_LABEL as NAME,
  NOTES_LABEL,
  PLAYERS_LABEL,
  RENAME_THIS_LOCATION,
} from '../recordings/recordingsCopy'
import { RECORDED_HEADER } from '../stats/copy'
import { FIND_A_PLACE } from './location/locationEditorCopy'
import { ADDED_LABEL, DETAILS, LINKED_TUNE_LABEL, REMOVE_FROM_TUNE } from './recordingPageCopy'

const TUNE_PATH = '/catalog/t1'
const FAST = 'Fast version'

async function seed(db: CrosstuneDb) {
  await db.tunes.put(tuneRow('t1', 'Old Joe Clark'))
  await db.user_tunes.put(userTuneRow('u-t1', 't1'))
  await db.recordings.put(
    recordingRow('rA', {
      tune_id: 't1',
      label: FAST,
      duration_ms: 60_000,
      source_duration_ms: 60_000,
    }),
  )
  await db.recording_files.put(
    recordingFile('rA', {
      blob: new Blob(['x'], { type: 'audio/mp4' }),
      local_duration_ms: 60_000,
    }),
  )
}

const title = () => page.getByRole('heading', { level: 1, name: FAST, exact: true })

async function mount(
  frame = WIDE,
  {
    lapsed = false,
    before,
    mapkit,
  }: {
    lapsed?: boolean
    before?: (db: CrosstuneDb) => Promise<unknown>
    /** MapKit's fake; left out, MapKit never loads. */
    mapkit?: FakeMapKitOptions
  } = {},
) {
  const db = openTestDb()
  await seed(db)
  await before?.(db)
  if (lapsed) await db.entitlements.put(entitlementRow())
  const analytics = recordingAnalytics()
  await renderApp({
    path: recordingPath(TUNE_PATH, 'rA'),
    db,
    frame,
    playbackEngine: fakePlaybackEngine(),
    wrap: (app) => (
      <AnalyticsProvider client={analytics}>
        <MapKitContext.Provider value={async () => (mapkit ? fakeMapKit(mapkit).mapkit : null)}>
          {app}
        </MapKitContext.Provider>
      </AnalyticsProvider>
    ),
  })
  await expect.element(title()).toBeVisible()
  return { db, analytics }
}

const attributes = () => page.getByRole('complementary', { name: DETAILS })
/** A row of the attributes column, by its label and the value it shows, or any value. */
const row = (label: string, value?: string) =>
  attributes().getByRole('button', {
    name: value === undefined ? new RegExp(`^${label}, `) : `${label}, ${value}`,
    exact: true,
  })
const editor = (label: string) => page.getByRole('dialog', { name: label })
// Held as long as a person holds a click, so the page draws frames between press and release.
const pressOutside = () =>
  userEvent.click(page.elementLocator(document.body), { position: { x: 400, y: 600 }, delay: 100 })
/**
 * Saves a player through the Players row and waits for it, so any write the page started
 * before it has landed too.
 */
async function settleWrites(db: CrosstuneDb) {
  await row(PLAYERS_LABEL, NOT_SET).click()
  await editor(PLAYERS_LABEL).getByRole('combobox', { name: PLAYERS_LABEL }).fill('Settled')
  await userEvent.keyboard('{Enter}')
  await expect.poll(async () => (await db.recordings.get('rA'))?.players).toBe('Settled')
}
const sent = (analytics: ReturnType<typeof recordingAnalytics>, name: string) =>
  analytics.sends().filter((send) => send.name === name)

it('renames from the Name row and saves on dismissal', async () => {
  const { db, analytics } = await mount()
  await row(NAME, FAST).click()
  const field = editor(NAME).getByRole('textbox', { name: RECORDING_NAME_LABEL })
  await expect.element(field).toHaveFocus()
  await field.fill('Reel version')
  await pressOutside()
  await expect.element(editor(NAME)).not.toBeInTheDocument()
  await expect.element(row(NAME, 'Reel version')).toBeVisible()
  await expect.poll(async () => (await db.recordings.get('rA'))?.label).toBe('Reel version')
  await expect
    .poll(() => sent(analytics, 'recording_renamed'))
    .toEqual([{ name: 'recording_renamed', props: { origin: 'recorded', recording_id: 'rA' } }])
})

it('escape in the Name editor writes nothing', async () => {
  const { db, analytics } = await mount()
  await row(NAME, FAST).click()
  await editor(NAME).getByRole('textbox', { name: RECORDING_NAME_LABEL }).fill('Reel version')
  await userEvent.keyboard('{Escape}')
  await expect.element(editor(NAME)).not.toBeInTheDocument()
  await expect.element(row(NAME, FAST)).toBeVisible()
  await settleWrites(db)
  expect((await db.recordings.get('rA'))?.label).toBe(FAST)
  expect(sent(analytics, 'recording_renamed')).toEqual([])
})

it('files under a tune from the Linked Tune row', async () => {
  const { db, analytics } = await mount()
  const { tuneId } = await createTune(db, { title: 'Cluck Old Hen' }, { status: 'known' })
  await row(LINKED_TUNE_LABEL, 'Old Joe Clark').click()
  const picker = editor(LINKED_TUNE_LABEL)
  await picker.getByRole('searchbox', { name: SEARCH_TUNES }).fill('cluck')
  await picker.getByRole('row', { name: addToTuneName('Cluck Old Hen'), exact: true }).click()
  await expect.element(picker).not.toBeInTheDocument()
  await expect.poll(async () => (await db.recordings.get('rA'))?.tune_id).toBe(tuneId)
  await expect.element(row(LINKED_TUNE_LABEL, 'Cluck Old Hen')).toBeVisible()
  await expect
    .poll(() => sent(analytics, 'recording_filed'))
    .toEqual([
      {
        name: 'recording_filed',
        props: { from: 'other_tune', origin: 'recorded', recording_id: 'rA', tune_id: tuneId },
      },
    ])
})

it('files under the match Enter picks in the tune search', async () => {
  const { db } = await mount()
  const { tuneId } = await createTune(db, { title: 'Cluck Old Hen' }, { status: 'known' })
  await row(LINKED_TUNE_LABEL, 'Old Joe Clark').click()
  await editor(LINKED_TUNE_LABEL)
    .getByRole('searchbox', { name: SEARCH_TUNES })
    .fill('Cluck Old Hen')
  await userEvent.keyboard('{Enter}')
  await expect.poll(async () => (await db.recordings.get('rA'))?.tune_id).toBe(tuneId)
  await expect.element(editor(LINKED_TUNE_LABEL)).not.toBeInTheDocument()
})

it('files under a tune made from the typed title, staying on the page', async () => {
  const { db, analytics } = await mount()
  await row(LINKED_TUNE_LABEL, 'Old Joe Clark').click()
  const picker = editor(LINKED_TUNE_LABEL)
  await picker.getByRole('searchbox', { name: SEARCH_TUNES }).fill('Sally Goodin')
  await picker
    .getByRole('button', {
      name: addTypedTitleLabel({ kind: 'create', title: 'Sally Goodin', another: false }),
    })
    .click()
  await expect.element(picker).not.toBeInTheDocument()
  await expect.element(row(LINKED_TUNE_LABEL, 'Sally Goodin')).toBeVisible()
  const created = async () => (await db.tunes.where('title').equals('Sally Goodin').first())?.id
  await expect.poll(created).toBeDefined()
  const tuneId = await created()
  await expect.poll(async () => (await db.recordings.get('rA'))?.tune_id).toBe(tuneId)
  await expect
    .poll(() => sent(analytics, 'tune_created')[0]?.props)
    .toMatchObject({ source: 'recording_screen' })
  await expect.poll(() => sent(analytics, 'recording_filed')).toHaveLength(1)
  await expect.element(title()).toBeVisible()
})

it('unfiles from the Linked Tune row', async () => {
  const { db, analytics } = await mount()
  await row(LINKED_TUNE_LABEL, 'Old Joe Clark').click()
  await editor(LINKED_TUNE_LABEL).getByRole('button', { name: REMOVE_FROM_TUNE }).click()
  await expect.element(editor(LINKED_TUNE_LABEL)).not.toBeInTheDocument()
  await expect.poll(async () => (await db.recordings.get('rA'))?.tune_id).toBeNull()
  await expect.element(row(LINKED_TUNE_LABEL, NOT_SET)).toBeVisible()
  await expect
    .poll(() => sent(analytics, 'recording_unfiled'))
    .toEqual([{ name: 'recording_unfiled', props: { origin: 'recorded', recording_id: 'rA' } }])
})

it('sets a partial recorded date', async () => {
  const { db } = await mount(WIDE, {
    before: (db) => db.recordings.update('rA', { recorded_at: null, recorded_precision: null }),
  })
  await row(RECORDED_HEADER, NOT_SET).click()
  const date = editor(RECORDED_HEADER)
  await date.getByRole('textbox', { name: YEAR_LABEL }).fill('2019')
  await date.getByRole('button', { name: new RegExp(`${MONTH_LABEL}$`) }).click()
  await page.getByRole('option', { name: MONTH_LABELS[2]! }).click()
  await pressOutside()
  await expect.element(date).not.toBeInTheDocument()
  await expect.poll(async () => (await db.recordings.get('rA'))?.recorded_precision).toBe('month')
  await expect
    .poll(async () => (await db.recordings.get('rA'))?.recorded_at)
    .toBe('2019-03-01T00:00:00.000Z')
})

it('keeps the exact time of a date left alone, saying when it was', async () => {
  const { db } = await mount()
  await row(RECORDED_HEADER).click()
  const date = editor(RECORDED_HEADER)
  await expect
    .element(date.getByText(recordedAtNote(recordedTime('2026-01-01T12:00:00.000Z'))))
    .toBeVisible()
  await pressOutside()
  await expect.element(date).not.toBeInTheDocument()
  await settleWrites(db)
  expect((await db.recordings.get('rA'))?.recorded_precision).toBe('time')
})

it('offers the players named on other recordings, and saves a pick at once', async () => {
  const { db } = await mount(WIDE, {
    before: (db) => db.recordings.put(recordingRow('rB', { players: 'Tommy Jarrell' })),
  })
  await row(PLAYERS_LABEL, NOT_SET).click()
  await page.getByRole('combobox', { name: PLAYERS_LABEL }).fill('Tom')
  await page.getByRole('option', { name: 'Tommy Jarrell', exact: true }).click()
  await expect.element(editor(PLAYERS_LABEL)).not.toBeInTheDocument()
  await expect.poll(async () => (await db.recordings.get('rA'))?.players).toBe('Tommy Jarrell')
})

it('Added is read only', async () => {
  await mount()
  await expect
    .element(attributes().getByRole('group', { name: new RegExp(`^${ADDED_LABEL}, `) }))
    .toBeVisible()
  expect(
    attributes()
      .getByRole('button', { name: new RegExp(`^${ADDED_LABEL},`) })
      .query(),
  ).toBeNull()
})

it("shows the place, and a saved location's address under it", async () => {
  await mount(WIDE, {
    before: async (db) => {
      await db.places.put(placeRow('p1', 'The barn', { address: '12 Mill Rd, Galax, VA' }))
      await db.recordings.update('rA', { place_id: 'p1', place_lat: 36.66, place_lon: -80.92 })
    },
  })
  await expect.element(row(LOCATION_LABEL, 'The barn')).toBeVisible()
  await expect.element(attributes().getByText('12 Mill Rd, Galax, VA')).toBeVisible()
})

const drawnMap = () => attributes().element().querySelector('[data-location-map] > div')

const deviceFix = {
  place_name: '12 Mill Rd, Galax, VA',
  place_lat: 36.66,
  place_lon: -80.92,
  place_accuracy_m: 40,
  place_origin: 'device',
} as const

it('draws the map for a device fix the server named, in the attributes column', async () => {
  await mount(WIDE, { before: (db) => db.recordings.update('rA', deviceFix), mapkit: {} })
  await expect.element(row(LOCATION_LABEL, deviceFix.place_name)).toBeVisible()
  await expect.poll(drawnMap).toBeTruthy()
})

it('draws the map for a device fix the server named, on the Details tab', async () => {
  await mount(PHONE, { before: (db) => db.recordings.update('rA', deviceFix), mapkit: {} })
  await page.getByRole('tab', { name: DETAILS, exact: true }).click()
  const details = page.getByRole('tabpanel', { name: DETAILS })
  await expect
    .element(details.getByRole('button', { name: `${LOCATION_LABEL}, ${deviceFix.place_name}` }))
    .toBeVisible()
  await expect.poll(() => details.element().querySelector('[data-location-map] > div')).toBeTruthy()
})

it("draws the map at a linked saved location's point when the recording has none", async () => {
  await mount(WIDE, {
    before: async (db) => {
      await db.places.put(placeRow('p1', 'The barn', { address: '12 Mill Rd, Galax, VA' }))
      await db.recordings.update('rA', { place_id: 'p1' })
    },
    mapkit: {},
  })
  await expect.element(row(LOCATION_LABEL, 'The barn')).toBeVisible()
  await expect.poll(drawnMap).toBeTruthy()
  await expect.element(attributes().getByText('12 Mill Rd, Galax, VA')).toBeVisible()
})

it('renames a linked saved location from the editor, and the Location row follows', async () => {
  const { db } = await mount(WIDE, {
    before: async (db) => {
      await db.places.put(placeRow('p1', 'The barn'))
      await db.recordings.update('rA', { place_id: 'p1' })
    },
  })
  await row(LOCATION_LABEL, 'The barn').click()
  await editor(LOCATION_LABEL).getByRole('button', { name: RENAME_THIS_LOCATION }).click()
  await editor(RENAME_THIS_LOCATION)
    .getByRole('textbox', { name: LOCATION_NAME_LABEL })
    .fill('Back barn')
  await userEvent.keyboard('{Enter}')
  await editor(LOCATION_LABEL).getByRole('button', { name: DONE, exact: true }).click()
  await expect.element(row(LOCATION_LABEL, 'Back barn')).toBeVisible()
  expect(await db.places.get('p1')).toMatchObject({ name: 'Back barn' })
})

it('opens the location editor from the Location row, as a sheet', async () => {
  await mount(WIDE)
  await row(LOCATION_LABEL, NOT_SET).click()
  await expect
    .element(editor(LOCATION_LABEL).getByRole('searchbox', { name: FIND_A_PLACE }))
    .toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(editor(LOCATION_LABEL)).not.toBeInTheDocument()
})

it('opens the location editor from a press on the map, and saves a pick on Done', async () => {
  const { db, analytics } = await mount(WIDE, {
    before: (db) =>
      db.recordings.update('rA', {
        place_name: 'Galax, VA',
        place_lat: 36.66,
        place_lon: -80.92,
      }),
    mapkit: {},
  })
  await expect.poll(drawnMap).toBeTruthy()
  await userEvent.click(page.elementLocator(drawnMap()!))
  const sheet = editor(LOCATION_LABEL)
  await sheet.getByRole('button', { name: CLEAR_LOCATION }).click()
  await sheet.getByRole('button', { name: DONE, exact: true }).click()
  await expect.element(row(LOCATION_LABEL, NOT_SET)).toBeVisible()
  await expect.poll(async () => (await db.recordings.get('rA'))?.place_lat).toBeNull()
  await expect
    .poll(() => sent(analytics, 'recording_place_cleared'))
    .toEqual([{ name: 'recording_place_cleared', props: { recording_id: 'rA' } }])
})

it('an empty Location row reads Not set', async () => {
  await mount()
  await expect.element(row(LOCATION_LABEL, NOT_SET)).toBeVisible()
})

it('heads only the details group, since the Location and Notes rows name their own', async () => {
  await mount()
  await expect.element(row(NOTES_LABEL, NOT_SET)).toBeVisible()
  expect(
    attributes()
      .getByRole('heading')
      .elements()
      .map((heading) => heading.textContent),
  ).toEqual([DETAILS])
})

it('an empty Players row reads Not set', async () => {
  await mount()
  await expect.element(row(PLAYERS_LABEL, NOT_SET)).toBeVisible()
})

it('Notes keeps line breaks', async () => {
  const { db } = await mount()
  await row(NOTES_LABEL, NOT_SET).click()
  const field = editor(NOTES_LABEL).getByRole('textbox', { name: NOTES_LABEL })
  await expect.element(field).toHaveFocus()
  await userEvent.keyboard('Tune the A down{Enter}Watch the B part')
  await expect.element(editor(NOTES_LABEL)).toBeVisible()
  await pressOutside()
  await expect
    .poll(async () => (await db.recordings.get('rA'))?.notes)
    .toBe('Tune the A down\nWatch the B part')
})

it("a lapsed account's page rows still open their editors", async () => {
  await mount(PHONE, { lapsed: true })
  await page.getByRole('tab', { name: DETAILS, exact: true }).click()
  const details = page.getByRole('tabpanel', { name: DETAILS })
  await details.getByRole('button', { name: `${NAME}, ${FAST}`, exact: true }).click()
  await expect
    .element(editor(NAME).getByRole('textbox', { name: RECORDING_NAME_LABEL }))
    .toBeVisible()
})
