import { expect, test, type Page } from '@playwright/test'
import { addSong, expectSettled, signIn, swipeLeft, unique } from './helpers'

async function songOrder(page: Page, tag: string): Promise<string[]> {
  const titles = await page
    .getByRole('main')
    .getByRole('listitem')
    .getByRole('link')
    .allTextContents()
  // A row's text runs the title into the metadata after it, so match the known names.
  return titles.flatMap((text) => {
    const match = text.match(new RegExp(`${tag} (Arkansas|Billy|Cripple)`))
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
    await page.getByRole('link', { name: 'Crosstune' }).click()
    await addSong(page, `${tag} ${name}`, key)
  }

  await page.getByRole('link', { name: 'Lists' }).click()
  await page.getByRole('textbox', { name: 'New list name' }).fill(tag)
  await page.getByRole('button', { name: 'Create list' }).click()
  await page.getByRole('link', { name: new RegExp(tag) }).click()
  for (const name of ['Arkansas', 'Billy', 'Cripple']) {
    await page.getByRole('searchbox', { name: 'Add a song' }).fill(`${tag} ${name}`)
    await page.getByRole('button', { name: `Add ${tag} ${name}` }).click()
  }
  await expect.poll(() => songOrder(page, tag)).toEqual(['Arkansas', 'Billy', 'Cripple'])

  // Drag Arkansas below Cripple by its handle with the mouse.
  const handle = page.getByRole('button', { name: `Reorder ${tag} Arkansas` })
  const target = page.getByRole('button', { name: `Reorder ${tag} Cripple` })
  const from = await handle.boundingBox()
  const to = await target.boundingBox()
  if (!from || !to) throw new Error('handles are not visible')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2, to.y + to.height, { steps: 20 })
  await page.mouse.up()
  await expectSettled(handle)
  await expect.poll(() => songOrder(page, tag)).toEqual(['Billy', 'Cripple', 'Arkansas'])
  // A drag must not leave the handle's menu open behind it.
  await expect(page.getByRole('button', { name: 'Move to top' })).toBeHidden()

  // Tap Cripple's handle and move it to the top from the menu.
  await page.getByRole('button', { name: `Reorder ${tag} Cripple` }).click()
  await page.getByRole('button', { name: 'Move to top' }).click()
  await expect.poll(() => songOrder(page, tag)).toEqual(['Cripple', 'Billy', 'Arkansas'])

  // Remove Billy from the list with a swipe; the song itself stays in the catalog.
  await swipeLeft(page, page.getByRole('link', { name: new RegExp(`${tag} Billy`) }))
  await page.getByRole('button', { name: `Remove ${tag} Billy` }).click()
  await expect.poll(() => songOrder(page, tag)).toEqual(['Cripple', 'Arkansas'])
  await page.reload()
  await expect.poll(() => songOrder(page, tag)).toEqual(['Cripple', 'Arkansas'])
})
