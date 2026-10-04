import { expect, test, type Page } from '@playwright/test'
import {
  addTune,
  expectNoOverlay,
  expectSettled,
  openTab,
  requestedProviders,
  signIn,
  stubSearch,
  unique,
  type StubbedGroup,
} from './helpers'

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
  await openTab(page, 'Settings')
  await page.getByRole('button', { name: /^Music services/ }).click()
  for (const name of SERVICES) {
    const box = page.getByRole('checkbox', { name })
    await expect(box).toBeVisible()
    const on = chosen.includes(name)
    if ((await box.isChecked()) !== on) {
      await box.click()
      await (on ? expect(box).toBeChecked() : expect(box).not.toBeChecked())
    }
  }
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expectNoOverlay(page)
}

/** Opens the tune page left on the Catalog tab, then its add menu. */
async function openAddMenu(page: Page, title: string): Promise<void> {
  // The Catalog tab keeps the tune page it was left on.
  await openTab(page, 'Catalog')
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Add recording' }).click()
}

/** The signed-in user is shared with other specs, so put the setting back. A reload first
 * clears any sheet a failed step left open over the tabs. */
async function restoreServices(page: Page): Promise<void> {
  await page.reload()
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
    await page.getByRole('button', { name: 'Find recordings', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Find recordings' })).toBeVisible()

    // Opening lists the chosen services and searches none of them.
    await expect(page.getByRole('button', { name: 'Search Apple Music' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Search Spotify' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Search SoundCloud' })).toHaveCount(0)
    expect(requests).toHaveLength(0)

    // A search-only service opens its own search page and leaves the list in place.
    const popup = page.waitForEvent('popup')
    await page.getByRole('button', { name: 'Search Spotify' }).click()
    const tab = await popup
    await tab.waitForURL(SPOTIFY_SEARCH)
    expect(await tab.evaluate(() => window.opener)).toBeNull()
    await tab.close()
    await expect(page.getByRole('dialog', { name: 'Find recordings' })).toBeVisible()

    await page.getByRole('button', { name: 'Search Apple Music' }).click()
    await expect(page.getByRole('dialog', { name: 'Apple Music' })).toBeVisible()
    const play = page.getByRole('button', { name: `Play ${HIT_TITLE}` })
    await expect(play).toBeVisible()
    await expect(page.getByRole('link', { name: 'Search on Apple Music' })).toBeVisible()
    expect(requestedProviders(requests.at(-1)!)).toEqual(['apple_music'])

    await play.click()
    await expect(page.locator('iframe[src*="embed.music.apple.com"]')).toBeVisible()

    const link = page.getByRole('button', { name: `Link ${HIT_TITLE}` })
    await expectSettled(link)
    await link.click()
    await expect(page.getByRole('button', { name: `Linked ${HIT_TITLE}` })).toBeDisabled()

    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Find recordings' })).toBeVisible()
    await expect(page.locator('iframe[src*="embed.music.apple.com"]')).toHaveCount(0)

    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(page.locator('ion-modal.show-modal')).toHaveCount(0)
    const media = page.getByRole('list', { name: 'Recordings' })
    await expect(media.getByRole('button', { name: `Play ${HIT_TITLE}` })).toBeVisible()
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
    await page.getByRole('button', { name: 'Search TIDAL', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'TIDAL' })).toBeVisible()
    await expect(page.getByText('No results')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Search on TIDAL' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toHaveCount(0)
    expect(requests.map(requestedProviders)).toEqual([['tidal']])
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expectNoOverlay(page)

    await chooseServices(page, ['Spotify'])
    await openAddMenu(page, title)
    const popup = page.waitForEvent('popup')
    await page.getByRole('button', { name: 'Search Spotify', exact: true }).click()
    const tab = await popup
    await tab.waitForURL(SPOTIFY_SEARCH)
    await tab.close()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  } finally {
    await restoreServices(page)
  }
})
