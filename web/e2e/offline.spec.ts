import { expect, test } from '@playwright/test'
import { addSong, expectSynced, signIn, unique } from './helpers'

test('a tune added offline syncs on reconnect', async ({ browser, page, context }) => {
  await signIn(page)
  const online = unique('Online Tune')
  const offline = unique('Offline Tune')
  const addedOnline = new Date().toISOString()
  await addSong(page, online, 'A')
  await expectSynced(page, addedOnline)
  await page.getByRole('link', { name: 'Crosstune' }).click()

  await context.setOffline(true)
  await addSong(page, offline, 'G')
  await page.getByRole('link', { name: 'Crosstune' }).click()
  await expect(page.getByRole('link', { name: new RegExp(offline) })).toBeVisible()
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-status', 'offline')

  const reconnected = new Date().toISOString()
  await context.setOffline(false)
  await expectSynced(page, reconnected)

  const other = await browser.newContext({ ...test.info().project.use })
  const otherPage = await other.newPage()
  await signIn(otherPage)
  await expect(otherPage.getByRole('link', { name: new RegExp(online) })).toBeVisible()
  await expect(otherPage.getByRole('link', { name: new RegExp(offline) })).toBeVisible()
  await other.close()
})
