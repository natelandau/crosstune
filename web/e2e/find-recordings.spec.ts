import { expect, test, type Page } from '@playwright/test'
import {
  addTune,
  expectNoOverlay,
  expectSettled,
  expectSynced,
  openSetting,
  openTab,
  requestedProviders,
  setSwitch,
  signIn,
  stubSearch,
  tunePage,
  unique,
  type StubbedGroup,
} from './helpers'
import {
  BACK,
  FIND_RECORDINGS,
  linkedResult,
  linkResult,
  NO_RESULTS,
  playResult,
  searchOn,
  searchService,
} from '../src/features/links/findRecordingsCopy'
import { DONE } from '../src/ui/confirmCopy'
import { ADD_RECORDING } from '../src/features/tune/tuneMediaCopy'
import { RECORDINGS_SECTION } from '../src/features/tune/tuneScreenCopy'

const HIT_TITLE = 'The Silver Spear'
const SPOTIFY_SEARCH = 'https://open.spotify.com/search/silver%20spear'

const SERVICES = [
  'Apple Music',
  'TIDAL',
  'Internet Archive',
  'Slippery-Hill',
  'YouTube',
  'Spotify',
  'Bandcamp',
  'SoundCloud',
]

const GROUPS: StubbedGroup[] = [
  {
    provider: 'apple_music',
    status: 'results',
    results: [
      {
        url: 'https://music.apple.com/us/album/the-silver-spear/1440911361?i=1440911367',
        provider: 'apple_music',
        provider_ref: '1440911367',
        title: HIT_TITLE,
        subtitle: 'The Chieftains',
        artwork_url: null,
      },
    ],
    search_url: 'https://music.apple.com/us/search?term=silver+spear',
  },
  { provider: 'tidal', status: 'results', results: [], search_url: 'https://tidal.com/search' },
  { provider: 'spotify', status: 'search_only', results: [], search_url: SPOTIFY_SEARCH },
]

/** Chooses exactly `chosen` among the music services. */
async function chooseServices(page: Page, chosen: string[]): Promise<void> {
  await openSetting(page, 'Music services')
  for (const name of SERVICES) {
    await setSwitch(page, page.getByRole('switch', { name, exact: true }), chosen.includes(name))
  }
}

/** Opens the tune page left on the Catalog tab, then its add menu. */
async function openAddMenu(page: Page, title: string): Promise<void> {
  await openTab(page, 'catalog', { root: false })
  await expect(tunePage(page).getByRole('heading', { name: title, level: 1 })).toBeVisible()
  await tunePage(page).getByRole('button', { name: ADD_RECORDING }).click()
}

/** The signed-in user is shared with other specs, so put the setting back. A reload first
 * clears any sheet a failed step left open over the tabs. */
async function restoreServices(page: Page): Promise<void> {
  await page.reload()
  await expectSynced(page)
  await chooseServices(page, SERVICES)
}

test('pick a service, find a recording on it, play it inline, and link it', async ({ page }) => {
  await signIn(page)
  const requests = await stubSearch(page, GROUPS)
  // The search-only service's page opens in a tab, which never reaches the real service.
  await page
    .context()
    .route('https://open.spotify.com/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<title>Spotify</title>' }),
    )

  const title = unique(HIT_TITLE)
  await addTune(page, title, 'D')

  try {
    await chooseServices(
      page,
      SERVICES.filter((name) => name !== 'SoundCloud'),
    )
    await openAddMenu(page, title)
    await page.getByRole('menuitem', { name: FIND_RECORDINGS, exact: true }).click()
    const find = page.getByRole('dialog', { name: FIND_RECORDINGS })
    await expect(find).toBeVisible()

    // Opening lists the chosen services and searches none of them.
    await expect(find.getByRole('button', { name: searchService('Apple Music') })).toBeVisible()
    await expect(find.getByRole('button', { name: searchService('Spotify') })).toBeVisible()
    await expect(find.getByRole('button', { name: searchService('SoundCloud') })).toHaveCount(0)
    expect(requests).toHaveLength(0)

    // A search-only service opens its own search page and leaves the list in place.
    const popup = page.waitForEvent('popup')
    await find.getByRole('button', { name: searchService('Spotify') }).click()
    const tab = await popup
    await tab.waitForURL(SPOTIFY_SEARCH)
    expect(await tab.evaluate(() => window.opener)).toBeNull()
    await tab.close()
    await expect(find).toBeVisible()

    await find.getByRole('button', { name: searchService('Apple Music') }).click()
    const service = page.getByRole('dialog', { name: 'Apple Music' })
    await expect(service).toBeVisible()
    const play = service.getByRole('button', { name: playResult(HIT_TITLE) })
    await expect(play).toBeVisible()
    await expect(service.getByRole('link', { name: searchOn('Apple Music') })).toBeVisible()
    expect(requestedProviders(requests.at(-1)!)).toEqual(['apple_music'])

    await play.click()
    await expect(page.locator('iframe[src*="embed.music.apple.com"]')).toBeVisible()

    const link = service.getByRole('button', { name: linkResult(HIT_TITLE) })
    await expectSettled(link)
    await link.click()
    await expect(service.getByRole('button', { name: linkedResult(HIT_TITLE) })).toBeDisabled()

    await service.getByRole('button', { name: BACK, exact: true }).click()
    await expect(find).toBeVisible()
    await expect(page.locator('iframe[src*="embed.music.apple.com"]')).toHaveCount(0)

    await find.getByRole('button', { name: DONE, exact: true }).click()
    await expectNoOverlay(page)
    const media = tunePage(page).getByRole('grid', { name: RECORDINGS_SECTION })
    await expect(
      media.getByRole('row', { name: new RegExp(`^${playResult(HIT_TITLE)},`) }),
    ).toBeVisible()
  } finally {
    await restoreServices(page)
  }
})

test('go straight to the one chosen service', async ({ page }) => {
  await signIn(page)
  const requests = await stubSearch(page, GROUPS)
  await page
    .context()
    .route('https://open.spotify.com/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<title>Spotify</title>' }),
    )

  const title = unique(HIT_TITLE)
  await addTune(page, title, 'G')

  try {
    await chooseServices(page, ['TIDAL'])
    await openAddMenu(page, title)
    // With one service chosen, the add menu searches it in place of listing the services.
    await page.getByRole('menuitem', { name: searchService('TIDAL'), exact: true }).click()
    const service = page.getByRole('dialog', { name: 'TIDAL' })
    await expect(service).toBeVisible()
    await expect(service.getByText(NO_RESULTS)).toBeVisible()
    await expect(service.getByRole('link', { name: searchOn('TIDAL') })).toBeVisible()
    await expect(service.getByRole('button', { name: BACK, exact: true })).toHaveCount(0)
    expect(requests.map(requestedProviders)).toEqual([['tidal']])
    await service.getByRole('button', { name: DONE, exact: true }).click()
    await expectNoOverlay(page)

    await chooseServices(page, ['Spotify'])
    await openAddMenu(page, title)
    const popup = page.waitForEvent('popup')
    await page.getByRole('menuitem', { name: searchService('Spotify'), exact: true }).click()
    const tab = await popup
    await tab.waitForURL(SPOTIFY_SEARCH)
    await tab.close()
    await expectNoOverlay(page)
  } finally {
    await restoreServices(page)
  }
})
