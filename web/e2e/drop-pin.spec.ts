import { expect, test, type Locator } from '@playwright/test'
import { fakeMapKit } from './fakeMapKit'
import {
  openRecordingPage,
  recordingAttribute,
  recordUnfiled,
  showDetails,
  signIn,
} from './helpers'
import {
  CANT_FIND_IT,
  DROP_A_PIN,
  FIND_A_PLACE,
  MOVE_THE_MAP,
  USE_THIS_SPOT,
} from '../src/features/recording/location/locationEditorCopy'
import {
  LOCATION_LABEL,
  NO_LOCATIONS_FOUND,
  pickLocationName,
} from '../src/features/recordings/recordingsCopy'
import { BACK, DONE } from '../src/ui/confirmCopy'

// The Stop button pulses continuously while recording, so Playwright's actionability
// check never sees it stable. Reduced motion turns the pulse off.
test.use({ reducedMotion: 'reduce' })

const PARK = {
  title: 'Felts Park',
  subtitle: 'Galax, VA',
  name: 'Felts Park',
  address: '601 S Main St, Galax, VA 24333, United States',
  kind: 'venue',
  lat: 36.6551,
  lon: -80.9234,
}

/** The name the stubbed reverse lookup gives a point, so each spot reads as its own. */
const spotName = (lat: number, lon: number) => `Spot ${lat.toFixed(4)} ${lon.toFixed(4)}`

const ENTRIES: { from: string; query: string; answer: (editor: Locator) => Locator }[] = [
  {
    from: 'the end of a result list',
    query: 'Felts',
    answer: (editor) =>
      editor.getByRole('button', {
        name: pickLocationName(PARK.title, PARK.subtitle),
        exact: true,
      }),
  },
  {
    from: 'a search with no results',
    query: 'Back porch',
    answer: (editor) => editor.getByText(NO_LOCATIONS_FOUND, { exact: true }),
  },
]

for (const { from, query, answer } of ENTRIES) {
  test(`drags the pin map opened from ${from} and uses the spot`, async ({ page }) => {
    await signIn(page)
    const center = await fakeMapKit(page)
    // No country center, so a search with no results leaves the pin map on the world view.
    await page.route('**/v1/me', async (route) => {
      const response = await route.fetch()
      await route.fulfill({ response, json: { ...(await response.json()), country_center: null } })
    })
    await page.route('**/v1/places/search**', (route) => {
      const q = new URL(route.request().url()).searchParams.get('q') ?? ''
      return route.fulfill({ json: { results: /felts/i.test(q) ? [PARK] : [] } })
    })
    const looked: { lat: number; lon: number }[] = []
    await page.route('**/v1/places/reverse**', async (route) => {
      const params = new URL(route.request().url()).searchParams
      const lat = Number(params.get('lat'))
      const lon = Number(params.get('lon'))
      looked.push({ lat, lon })
      await route.fulfill({ json: { name: spotName(lat, lon), address: null, lat, lon } })
    })

    await openRecordingPage(await recordUnfiled(page, 1))
    await showDetails(page)
    await recordingAttribute(page, LOCATION_LABEL).click()
    const editor = page.getByRole('dialog', { name: LOCATION_LABEL, exact: true })
    await editor.getByRole('searchbox', { name: FIND_A_PLACE, exact: true }).fill(query)
    await expect(answer(editor)).toBeVisible()
    await editor.getByRole('button', { name: `${CANT_FIND_IT} ${DROP_A_PIN}`, exact: true }).click()
    const use = editor.getByRole('button', { name: USE_THIS_SPOT, exact: true })
    // The sheet rises so Use this spot shows under the map without a drag.
    await expect(use).toBeInViewport()
    await expect.poll(center).not.toBeNull()
    const start = (await center())!

    // A drag across the map, which fills the space between the sheet's Back and the hint under it.
    const sheet = await editor.boundingBox()
    const back = (await editor.getByRole('button', { name: BACK, exact: true }).boundingBox())!
    const hint = (await editor.getByText(MOVE_THE_MAP, { exact: true }).boundingBox())!
    const x = sheet!.x + sheet!.width / 2
    const y = (back.y + back.height + hint.y) / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - 60, y - 80, { steps: 8 })
    await page.mouse.up()

    await expect.poll(center).not.toEqual(start)
    const moved = (await center())!
    const name = spotName(moved.latitude, moved.longitude)
    await expect(editor.getByRole('status').getByText(name, { exact: true })).toBeVisible()
    // The drag moved the map, never the sheet under it.
    expect(await editor.boundingBox()).toEqual(sheet)
    expect(looked.at(-1)).toEqual({ lat: moved.latitude, lon: moved.longitude })

    await use.click()
    await editor.getByRole('button', { name: DONE, exact: true }).click()
    await expect(editor).toHaveCount(0)
    await expect(recordingAttribute(page, LOCATION_LABEL, name)).toBeVisible()
  })
}
