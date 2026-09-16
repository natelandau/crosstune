import { expect, test } from '@playwright/test'
import { addSong, expectSynced, signIn, unique } from './helpers'

test('add a tune, link a recording, find it by key, and play it in the player', async ({
  page,
}) => {
  await signIn(page)
  const title = unique("Soldier's Joy")
  const since = new Date().toISOString()
  await addSong(page, title, 'D')

  await page.getByRole('button', { name: 'Paste link' }).click()
  await page
    .getByRole('textbox', { name: 'Link' })
    .fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  await page.getByRole('button', { name: 'Add link' }).click()
  const links = page.getByRole('list', { name: 'Recordings' })
  await expect(links.getByRole('button', { name: /^Play / })).toBeVisible()
  await expectSynced(page, since)

  await page.getByRole('link', { name: 'Crosstune' }).click()
  await page.getByRole('group', { name: 'Key' }).getByRole('button', { name: 'D' }).click()
  const card = page.getByRole('link', { name: new RegExp(title) })
  await expect(card).toBeVisible()
  await card.click()
  const play = page
    .getByRole('list', { name: 'Recordings' })
    .getByRole('button', { name: /^Play / })
  await expect(play).toBeVisible()
  await play.click()
  const frame = page.getByRole('region', { name: 'Player' }).locator('iframe[src*="dQw4w9WgXcQ"]')
  await expect(frame).toBeVisible()
  expect((await frame.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(199)
})
