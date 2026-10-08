import { expect, test } from '@playwright/test'
import { addTune, escapeRegExp, expectSynced, openTab, signIn, tunePage, unique } from './helpers'
import { ADD_LINK, LINK_FIELD, PASTE_LINK } from '../src/features/links/pasteLinkCopy'
import { PLAYER_REGION } from '../src/features/player/playerCopy'
import { ADD_RECORDING } from '../src/features/tune/tuneMediaCopy'
import { RECORDINGS_SECTION } from '../src/features/tune/tuneScreenCopy'
import { TUNE_LIST } from '../src/features/catalog/catalogCopy'
import { KEY } from '../src/ui/keyName'

test('add a tune, link a recording, find it by key, and play it in the player', async ({
  page,
}) => {
  await signIn(page)
  const title = unique("Soldier's Joy")
  const since = new Date().toISOString()
  await addTune(page, title, 'D')

  // Every way to add one lives behind Add recording on the Recordings heading.
  await tunePage(page).getByRole('button', { name: ADD_RECORDING }).click()
  await page.getByRole('menuitem', { name: PASTE_LINK, exact: true }).click()
  const sheet = page.getByRole('dialog', { name: PASTE_LINK })
  await sheet
    .getByRole('textbox', { name: LINK_FIELD })
    .fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  await sheet.getByRole('button', { name: ADD_LINK }).click()
  // A tune's recordings and its links share one list, which the recordings name.
  const media = tunePage(page).getByRole('grid', { name: RECORDINGS_SECTION })
  await expect(media.getByRole('row', { name: /^Play / })).toBeVisible()
  await expectSynced(page, since)

  await openTab(page, 'catalog')
  await page.getByRole('button', { name: /^Key: / }).click()
  await page
    .getByRole('dialog', { name: KEY })
    .getByRole('option', { name: 'D', exact: true })
    .click()
  const row = page
    .getByRole('grid', { name: TUNE_LIST })
    .getByRole('row', { name: new RegExp(`^${escapeRegExp(title)},`) })
  await expect(row).toBeVisible()
  await row.click()
  const play = tunePage(page)
    .getByRole('grid', { name: RECORDINGS_SECTION })
    .getByRole('row', { name: /^Play / })
  await expect(play).toBeVisible()
  // On the title line, clear of the source line under it, which links out to the service. The
  // title is whatever the service names the video, so the press goes by place, not by text.
  const box = await play.boundingBox()
  if (!box) throw new Error('the link row is not visible')
  await play.click({ position: { x: box.width / 2, y: box.height / 4 } })
  const frame = page
    .getByRole('region', { name: PLAYER_REGION })
    .locator('iframe[src*="dQw4w9WgXcQ"]')
  await expect(frame).toBeVisible()
  // A collapsed player would still count as visible.
  await expect
    .poll(async () => (await frame.boundingBox())?.height ?? 0)
    .toBeGreaterThanOrEqual(199)
})
