import { expect, test, type Page } from '@playwright/test'
import {
  openRecordingPage,
  openTab,
  playRecording,
  recordingAttribute,
  showDetails,
  recordingPage,
  recordUnfiled,
  renameRecording,
  signIn,
  unique,
} from './helpers'
import { PLAYER_REGION } from '../src/features/player/playerCopy'
import { ELAPSED_LABEL, PAUSE, PLAY } from '../src/features/player/transportCopy'
import {
  CANT_FIND_IT,
  DROP_A_PIN,
  FIND_A_PLACE,
  USE_THIS_SPOT,
} from '../src/features/recording/location/locationEditorCopy'
import {
  LOCATION_LABEL,
  NO_LOCATIONS_FOUND,
  PLAYERS_LABEL,
  pickLocationName,
  UNFILED_HEADER,
} from '../src/features/recordings/recordingsCopy'
import { DONE } from '../src/ui/confirmCopy'

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

const SPOT = {
  name: '108 Grayson St',
  address: '108 Grayson St, Galax, VA 24333, United States',
  lat: 36.6612,
  lon: -80.9239,
}

/**
 * Answer every place search and reverse lookup here, so no run reaches Apple Maps. A search for
 * the park finds it and every other search finds nothing; every point is the one spot.
 */
async function stubPlaces(page: Page): Promise<string[]> {
  const searched: string[] = []
  await page.route('**/v1/places/search**', async (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? ''
    searched.push(q)
    await route.fulfill({ json: { results: /felts/i.test(q) ? [PARK] : [] } })
  })
  await page.route('**/v1/places/reverse**', (route) => route.fulfill({ json: SPOT }))
  return searched
}

test('opens a recording page from its row, edits it there, and plays from the slot', async ({
  page,
}) => {
  await signIn(page)
  const searched = await stubPlaces(page)
  // Long enough to still be playing once its page opens.
  const unfiled = await recordUnfiled(page, 5)

  // A tap on the row opens its page, never plays it.
  await openRecordingPage(unfiled)
  await expect(page).toHaveURL(/\/recordings\/recording\/[^/]+$/)
  await expect(page.getByRole('region', { name: PLAYER_REGION })).toHaveCount(0)

  const name = unique('Page recording')
  await renameRecording(page, name)

  const players = unique('Tommy and Fred')
  await showDetails(page)
  await recordingAttribute(page, PLAYERS_LABEL).click()
  const playersEditor = page.getByRole('dialog', { name: PLAYERS_LABEL, exact: true })
  await playersEditor.getByRole('combobox', { name: PLAYERS_LABEL, exact: true }).fill(players)
  await page.keyboard.press('Enter')
  await expect(playersEditor).toHaveCount(0)
  await expect(recordingAttribute(page, PLAYERS_LABEL, players)).toBeVisible()

  // A place found by search.
  await recordingAttribute(page, LOCATION_LABEL).click()
  const locationEditor = page.getByRole('dialog', { name: LOCATION_LABEL, exact: true })
  const search = locationEditor.getByRole('searchbox', { name: FIND_A_PLACE, exact: true })
  await search.fill('Felts')
  await locationEditor
    .getByRole('button', { name: pickLocationName(PARK.title, PARK.subtitle), exact: true })
    .click()
  await locationEditor.getByRole('button', { name: DONE, exact: true }).click()
  await expect(locationEditor).toHaveCount(0)
  await expect(recordingAttribute(page, LOCATION_LABEL, PARK.name)).toBeVisible()
  expect(searched).toContain('Felts')

  // A place no search finds, set with a pin. It opens on the recording's own point.
  await recordingAttribute(page, LOCATION_LABEL).click()
  await search.fill('Back porch')
  await expect(locationEditor.getByText(NO_LOCATIONS_FOUND, { exact: true })).toBeVisible()
  await locationEditor
    .getByRole('button', { name: `${CANT_FIND_IT} ${DROP_A_PIN}`, exact: true })
    .click()
  await expect(locationEditor.getByRole('status').getByText(SPOT.name)).toBeVisible()
  await locationEditor.getByRole('button', { name: USE_THIS_SPOT, exact: true }).click()
  await locationEditor.getByRole('button', { name: DONE, exact: true }).click()
  await expect(locationEditor).toHaveCount(0)
  await expect(recordingAttribute(page, LOCATION_LABEL, SPOT.name)).toBeVisible()

  // Back on the list, the row's slot plays the recording and leaves the list in place.
  await openTab(page, 'recordings')
  const row = page
    .getByRole('grid', { name: UNFILED_HEADER, exact: true })
    .getByRole('row')
    .filter({ hasText: name })
  await playRecording(row)
  const player = page.getByRole('region', { name: PLAYER_REGION })
  await expect(player.getByRole('button', { name: PAUSE, exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/recordings$/)

  // Opening the page of what plays leaves it playing, with the page as its only player: the
  // page's elapsed time moves on and the player bar is gone.
  await openRecordingPage(row, name)
  await expect(recordingPage(page).getByRole('heading', { name, level: 1 })).toBeVisible()
  await expect(player).toHaveCount(0)
  // The elapsed time is on Details' play bar.
  await showDetails(page)
  const elapsed = recordingPage(page).getByRole('timer', {
    name: new RegExp(`^${ELAPSED_LABEL}`),
  })
  const opened = await elapsed.textContent()
  await expect.poll(() => elapsed.textContent()).not.toBe(opened)

  // Playback the row started outlives its page, and the player bar shows it again.
  await openTab(page, 'recordings')
  await expect(player).toBeVisible()
  await expect(row.getByRole('button', { name: /^Play / })).toHaveCount(0)
})

test("plays on a recording's page with no player bar, and stops when the page closes", async ({
  page,
}) => {
  await signIn(page)
  const unfiled = await recordUnfiled(page, 5)
  const opened = await openRecordingPage(unfiled)

  // Details' play bar on the phone, practice's transport on a wide page.
  await opened.getByRole('button', { name: PLAY, exact: true }).click()
  await expect(opened.getByRole('button', { name: PAUSE, exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: PLAYER_REGION })).toHaveCount(0)

  await openTab(page, 'recordings')
  await expect(unfiled.getByRole('button', { name: /^Play / })).toBeVisible()
  await expect(page.getByRole('region', { name: PLAYER_REGION })).toHaveCount(0)
})
