import { page } from 'vitest/browser'
import { expect, it, vi } from 'vitest'
import { AnalyticsProvider } from '../../analytics/AnalyticsProvider'
import { recordingAnalytics } from '../../analytics/testing'
import { openTestDb } from '../../test/db'
import { renderApp } from '../../test/renderApp'
import { linkRow, recordingRow, tuneRow, userTuneRow } from '../../test/rows'
import { openLinkName } from '../links/linkNames'
import { openOn } from '../recordings/recordingCopy'
import { TUNE } from './tunePageCopy'

const PHONE = { width: 390, height: 844 }
const AT = '2026-01-01T00:00:00.000Z'

/**
 * A tune with a link to a site the dock cannot embed and an imported recording's origin page,
 * in a list. Without the recording, the link is what the tune's list row plays.
 */
async function setup({ path = '/catalog/t1', recording = true } = {}) {
  const db = openTestDb()
  await db.tunes.put(tuneRow('t1', 'Cluck Old Hen'))
  await db.user_tunes.put(userTuneRow('u-t1', 't1'))
  await db.recording_links.put(
    linkRow('l1', 't1', {
      url: 'https://www.bandcamp.com/track/hen',
      provider: 'bandcamp',
      title: 'Hen on Bandcamp',
    }),
  )
  if (recording) {
    await db.recordings.put(
      recordingRow('r1', {
        tune_id: 't1',
        source: 'import',
        origin: 'slippery_hill',
        origin_url: 'https://www.slippery-hill.com/recording/1',
      }),
    )
  }
  const row = { created_at: AT, updated_at: AT, deleted_at: null, server_seq: 0 }
  await db.lists.put({ id: 'list1', ...row, name: 'Tuesday jam', position: 0 })
  await db.list_items.put({ id: 'i1', ...row, list_id: 'list1', user_tune_id: 'u-t1', position: 0 })
  const analytics = recordingAnalytics()
  // The anchors open new tabs; the click is observed, never followed.
  const stopNavigation = (event: Event) => event.preventDefault()
  document.addEventListener('click', stopNavigation)
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  await renderApp({
    path,
    db,
    frame: PHONE,
    wrap: (app) => <AnalyticsProvider client={analytics}>{app}</AnalyticsProvider>,
  })
  if (path.startsWith('/catalog/')) {
    await expect.element(page.getByRole('main', { name: TUNE })).toBeVisible()
  }
  return { analytics, open, stopNavigation }
}

it("opening a link's provider page sends link_opened_externally", async () => {
  const { analytics, stopNavigation } = await setup()
  try {
    await page.getByRole('link', { name: /Hen on Bandcamp on Bandcamp/ }).click()
    await expect
      .poll(() => analytics.sends())
      .toEqual([{ name: 'link_opened_externally', props: { service: 'bandcamp', link_id: 'l1' } }])
  } finally {
    document.removeEventListener('click', stopNavigation)
  }
})

it('tapping a link row that opens its provider site sends link_opened_externally', async () => {
  const { analytics, open, stopNavigation } = await setup()
  try {
    await page.getByRole('row', { name: /Hen on Bandcamp/ }).click()
    await expect.poll(() => open).toHaveBeenCalledOnce()
    expect(analytics.sends()).toEqual([
      { name: 'link_opened_externally', props: { service: 'bandcamp', link_id: 'l1' } },
    ])
  } finally {
    document.removeEventListener('click', stopNavigation)
  }
})

it("opening an archive recording's origin page sends nothing", async () => {
  const { analytics, stopNavigation } = await setup()
  try {
    const origin = page.getByRole('link', { name: openOn('Slippery-Hill') })
    await expect.element(origin).toBeVisible()
    await origin.click()
    // A link opened afterwards proves the origin click has been handled and reported nothing.
    await page.getByRole('link', { name: /Hen on Bandcamp on Bandcamp/ }).click()
    await expect.poll(() => analytics.sends()).toHaveLength(1)
    expect(analytics.sends()).toEqual([
      { name: 'link_opened_externally', props: { service: 'bandcamp', link_id: 'l1' } },
    ])
  } finally {
    document.removeEventListener('click', stopNavigation)
  }
})

it("a list row's open control sends link_opened_externally", async () => {
  const { analytics, open, stopNavigation } = await setup({
    path: '/lists/list1',
    recording: false,
  })
  try {
    await page.getByRole('button', { name: openLinkName('Hen on Bandcamp') }).click()
    await expect.poll(() => open).toHaveBeenCalledOnce()
    expect(analytics.sends()).toEqual([
      { name: 'link_opened_externally', props: { service: 'bandcamp', link_id: 'l1' } },
    ])
  } finally {
    document.removeEventListener('click', stopNavigation)
  }
})
