import { expect, test, type Page } from '@playwright/test'
import {
  addSong,
  escapeRegExp,
  expectSettled,
  expectSynced,
  openTab,
  signIn,
  swipeLeft,
  unique,
} from './helpers'

/**
 * A row's drag grip. It carries no name of its own: the named Reorder button beside it opens the
 * move menu instead, and Ionic starts a drag only from a press inside the grip.
 */
const grip = (page: Page, title: string) =>
  page.getByRole('listitem').filter({ hasText: title }).locator('ion-reorder')

async function songOrder(page: Page, tag: string): Promise<string[]> {
  // The listitem's own text, not a control inside it: a list row carries both an open control
  // and a Reorder button, so reading buttons would count each row more than once.
  const rows = await page.getByRole('main').getByRole('listitem').allTextContents()
  // A row's text runs the title into the metadata after it, so match the known names.
  return rows.flatMap((text) => {
    const match = text.match(new RegExp(`${escapeRegExp(tag)} (Arkansas|Billy|Cripple)`))
    return match ? [match[1]!] : []
  })
}

test('reorder a list by dragging a handle and from its menu, and swipe a song out', async ({
  page,
}) => {
  await signIn(page)
  const tag = unique('Set')
  for (const [name, key] of [
    ['Arkansas', 'D'],
    ['Billy', 'G'],
    ['Cripple', 'A'],
  ] as const) {
    await openTab(page, 'Catalog')
    await addSong(page, `${tag} ${name}`, key)
  }

  await openTab(page, 'Lists')
  // The screen's own Add list control, not the one the empty state offers.
  await page.getByRole('banner').getByRole('button', { name: 'Add list' }).click()
  await page.getByRole('textbox', { name: 'List name' }).fill(tag)
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  const listRow = page.getByRole('button', { name: new RegExp(`^${escapeRegExp(tag)} `) })
  await expect(listRow).toBeVisible()
  await listRow.click()
  // The screen's own Add songs control, not the one the empty state offers.
  await page.getByRole('banner').getByRole('button', { name: 'Add songs' }).click()
  for (const name of ['Arkansas', 'Billy', 'Cripple']) {
    await page.getByRole('searchbox', { name: 'Search songs' }).fill(`${tag} ${name}`)
    await page.getByRole('button', { name: `Add ${tag} ${name}` }).click()
  }
  const since = new Date().toISOString()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expect.poll(() => songOrder(page, tag)).toEqual(['Arkansas', 'Billy', 'Cripple'])
  // The pending write syncs on its own, and the pull rebuilds the list it lands in. A row
  // replaced under the pointer takes the gesture with it, so the gesture waits for it.
  await expectSynced(page, since)

  // Drag Arkansas below Cripple by its grip with the mouse.
  const handle = grip(page, `${tag} Arkansas`)
  const target = grip(page, `${tag} Cripple`)
  // Ionic caches every row's position as the drag starts, so the rows have to have stopped
  // moving: the picker's dismissal still has them sliding into place.
  await expect(page.locator('ion-modal.show-modal')).toHaveCount(0)
  await expectSettled(handle)
  const from = await handle.boundingBox()
  const to = await target.boundingBox()
  if (!from || !to) throw new Error('grips are not visible')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2, to.y + to.height, { steps: 20 })
  await page.mouse.up()
  await expectSettled(handle)
  await expect.poll(() => songOrder(page, tag)).toEqual(['Billy', 'Cripple', 'Arkansas'])
  // A drag must not leave the handle's menu open behind it.
  await expect(page.getByRole('button', { name: 'Move to top' })).toBeHidden()

  // Tap Cripple's handle and move it to the top from the menu.
  await page.getByRole('button', { name: `Reorder ${tag} Cripple`, exact: true }).click()
  await page.getByRole('button', { name: 'Move to top' }).click()
  await expect.poll(() => songOrder(page, tag)).toEqual(['Cripple', 'Billy', 'Arkansas'])

  // Remove Billy from the list with a swipe; the song itself stays in the catalog.
  await swipeLeft(
    page,
    page.getByRole('button', { name: new RegExp(`^\\d+ ${escapeRegExp(tag)} Billy`) }),
  )
  await page.getByRole('button', { name: `Remove ${tag} Billy` }).click()
  await expect.poll(() => songOrder(page, tag)).toEqual(['Cripple', 'Arkansas'])
  await page.reload()
  await expect.poll(() => songOrder(page, tag)).toEqual(['Cripple', 'Arkansas'])
})
