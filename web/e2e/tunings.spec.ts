import { expect, test } from '@playwright/test'
import {
  addTune,
  escapeRegExp,
  expectNoOverlay,
  openTab,
  playInstrument,
  signIn,
  unique,
} from './helpers'

test('a guitar capo shows on the catalog row', async ({ page }) => {
  await signIn(page)
  await playInstrument(page, 'Guitar')
  const title = unique('Capo tune')
  await openTab(page, 'Catalog')
  await addTune(page, title, 'G')

  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: 'Guitar capo, None', exact: true }) })
    .click()
  await page.getByRole('radio', { name: '2', exact: true }).click()
  await expectNoOverlay(page)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible()

  await openTab(page, 'Catalog')
  await page.getByRole('searchbox', { name: 'Search tunes' }).fill(title)
  // The search-and-create offer also names the title ("Add another "..."), so the row's own
  // open control, anchored at the title's start, is what tells the two apart.
  await expect(
    page.getByRole('button', { name: new RegExp(`^${escapeRegExp(title)}`) }),
  ).toHaveAccessibleName(/Capo 2/)
})
