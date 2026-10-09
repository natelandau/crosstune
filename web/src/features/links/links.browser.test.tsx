import { expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { ResolveResponse, SearchGroup, SearchResult } from '../../api/types'
import { AnalyticsProvider } from '../../usage/AnalyticsProvider'
import { recordingAnalytics } from '../../usage/testing'
import { settingsPagePath } from '../settings/settingsPaths'
import { toggleSearchProvider } from '../../commands/settings'
import type { CrosstuneDb } from '../../db/schema'
import { FIND_RECORDINGS, linkedResult, linkResult, searchService } from './findRecordingsCopy'
import { ADD_LINK, LINK_FIELD, LINK_NOT_WEB, PASTE_LINK } from './pasteLinkCopy'
import { MUSIC_SERVICES, SEARCHABLE_PROVIDERS } from '../settings/searchProviders'
import { ADD_RECORDING } from '../tune/tuneMediaCopy'
import type { SyncEngine } from '../../sync/types'
import { openTestDb } from '../../test/db'
import { tuneRow, userTuneRow } from '../../test/rows'
import { renderApp } from '../../test/renderApp'
import { TUNE } from '../tune/tunePageCopy'

const tunePage = () => page.getByRole('main', { name: TUNE })

async function seedTune(db: CrosstuneDb) {
  await db.tunes.put(tuneRow('t1', 'The Silver Spear', { tune_type: 'Reel' }))
  await db.user_tunes.put(userTuneRow('u-t1', 't1'))
}

async function openAdd(item: string) {
  await tunePage().getByRole('button', { name: ADD_RECORDING }).click()
  await page.getByRole('menuitem', { name: item }).click()
}

const silver: SearchResult = {
  url: 'https://music.apple.com/us/album/harvest-storm/1?i=2',
  provider: 'apple_music',
  provider_ref: '2',
  title: 'The Silver Spear',
  subtitle: 'Altan · Harvest Storm',
  artwork_url: null,
}

const apple: SearchGroup = {
  provider: 'apple_music',
  status: 'results',
  results: [silver],
  search_url: 'https://music.apple.com/search?term=silver',
}

it('refuses a link that is not a web address', async () => {
  const db = openTestDb()
  await seedTune(db)
  await renderApp({ path: '/catalog/t1', db })
  await openAdd(PASTE_LINK)
  const sheet = page.getByRole('dialog', { name: PASTE_LINK })
  await sheet.getByRole('textbox', { name: LINK_FIELD }).fill('ftp://example.com/reel')
  await sheet.getByRole('button', { name: ADD_LINK, exact: true }).click()
  await expect.element(sheet.getByRole('alert')).toHaveTextContent(LINK_NOT_WEB)
  expect(await db.recording_links.count()).toBe(0)
})

it('adds a pasted link as a row on the tune page', async () => {
  const db = openTestDb()
  await seedTune(db)
  const resolved: ResolveResponse = {
    url: 'https://youtu.be/dQw4w9WgXcQ',
    provider: 'youtube',
    provider_ref: 'dQw4w9WgXcQ',
    title: 'Silver Spear at the session',
    artwork_url: null,
  }
  await renderApp({ path: '/catalog/t1', db, sync: { resolveLink: async () => resolved } })
  await openAdd(PASTE_LINK)
  const sheet = page.getByRole('dialog', { name: PASTE_LINK })
  await sheet.getByRole('textbox', { name: LINK_FIELD }).fill(resolved.url)
  await sheet.getByRole('button', { name: ADD_LINK, exact: true }).click()
  await expect.element(sheet).not.toBeInTheDocument()
  await expect
    .element(tunePage().getByRole('row', { name: /Silver Spear at the session/ }))
    .toBeVisible()
})

it('searches a service only once it is tapped, and links a result', async () => {
  const db = openTestDb()
  await seedTune(db)
  const searchRecordings = vi.fn<SyncEngine['searchRecordings']>(async () => ({
    kind: 'ok',
    groups: [apple],
  }))
  await renderApp({ path: '/catalog/t1', db, sync: { searchRecordings } })
  await openAdd(FIND_RECORDINGS)
  const sheet = page.getByRole('dialog', { name: FIND_RECORDINGS })
  const appleRow = sheet.getByRole('button', { name: searchService('Apple Music') })
  await expect.element(appleRow).toBeVisible()
  expect(searchRecordings).not.toHaveBeenCalled()
  await appleRow.click()
  const link = page.getByRole('button', { name: linkResult(silver.title) })
  await expect.element(link).toBeVisible()
  expect(searchRecordings).toHaveBeenCalledOnce()
  await link.click()
  await expect
    .element(page.getByRole('button', { name: linkedResult(silver.title) }))
    .toBeDisabled()
  await expect.poll(() => db.recording_links.count()).toBe(1)
})

it('takes a musician with no music services to their settings', async () => {
  const db = openTestDb()
  await seedTune(db)
  for (const provider of SEARCHABLE_PROVIDERS) {
    await toggleSearchProvider(db, 'user_1', provider, false)
  }
  const { router } = await renderApp({ path: '/catalog/t1', db })
  await openAdd(FIND_RECORDINGS)
  await page.getByRole('button', { name: MUSIC_SERVICES }).click()
  await expect.poll(() => router.state.location.pathname).toBe(settingsPagePath('music-services'))
})

it('reports find_recordings once when the sheet opens', async () => {
  const analytics = recordingAnalytics()
  const db = openTestDb()
  await seedTune(db)
  await renderApp({
    path: '/catalog/t1',
    db,
    wrap: (app) => <AnalyticsProvider client={analytics}>{app}</AnalyticsProvider>,
  })
  await openAdd(FIND_RECORDINGS)
  await expect.element(page.getByRole('dialog', { name: FIND_RECORDINGS })).toBeVisible()
  const found = () =>
    analytics.calls.filter((c) => c.type === 'screen' && c.name === 'find_recordings')
  await expect.poll(() => found().length).toBe(1)
})
