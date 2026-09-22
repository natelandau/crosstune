import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { Shell } from '../../app/Shell'
import { createSong } from '../../commands/songs'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { MORE_ACTIONS } from '../../ui/Menu'
import { ADD_SONG } from './CatalogPage'
import { SEARCH_SONGS } from './SongSearch'

// The settings screen reads the account from Clerk, which only answers under a ClerkProvider.
vi.mock('@clerk/react', () => ({
  useAuth: () => ({ signOut: async () => {} }),
  useUser: () => ({ user: { primaryEmailAddress: { emailAddress: 'nate@example.com' } } }),
}))

let db: CrosstuneDb

beforeEach(async () => {
  db = openTestDb()
  await createSong(db, { title: "Soldier's Joy" }, { status: 'known' })
  await createSong(db, { title: 'Cluck Old Hen' }, { status: 'learning' })
})

afterEach(async () => {
  await db.delete()
})

const control = (name: string) => page.getByRole('button', { name })
// The bar stays mounted whether or not it is shown, so only visibility says which it is.
const tabBar = () => page.getByRole('navigation', { name: 'Primary', includeHidden: true })
/** An ion-button keeps its native button in a shadow root, which `closest` never leaves. */
function buttonHost(name: string): HTMLElement {
  const root = control(name).element().getRootNode()
  return (root as ShadowRoot).host as HTMLElement
}

describe('CatalogPage on iOS', () => {
  it('puts the bulk actions where the tab bar was, and gives it back on Done', async () => {
    renderIonic(<Shell initialPath="/catalog" />, { db })
    await expect.element(page.getByRole('heading', { name: 'Catalog', level: 1 })).toBeVisible()
    await expect.element(tabBar()).toBeVisible()

    await control(MORE_ACTIONS).click()
    await control('Select').click()
    await expect.element(control('Done')).toBeVisible()
    await expect.element(page.getByText('0 Selected').first()).toBeVisible()
    await expect.element(control('Status')).toBeVisible()
    await expect.element(tabBar()).not.toBeVisible()

    await control('Done').click()
    await expect.element(tabBar()).toBeVisible()
    await expect.element(control(ADD_SONG)).toBeVisible()
  })

  it('hides More actions when nothing matches the search', async () => {
    renderIonic(<Shell initialPath="/catalog" />, { db })
    await expect.element(page.getByRole('heading', { name: 'Catalog', level: 1 })).toBeVisible()
    await expect.element(control(MORE_ACTIONS)).toBeVisible()
    await page.getByRole('searchbox', { name: SEARCH_SONGS }).fill('zzz')
    await expect.element(control(MORE_ACTIONS)).not.toBeInTheDocument()
  })

  it('keeps every toolbar control at 44px on a 320px screen, gated or not', async () => {
    await page.viewport(320, 640)
    try {
      renderIonic(<Shell initialPath="/catalog" />, { db })
      await expect.element(control(MORE_ACTIONS)).toBeVisible()
      for (const name of ['Filters', ADD_SONG, MORE_ACTIONS]) {
        const box = buttonHost(name).getBoundingClientRect()
        expect(box.height, name).toBeGreaterThanOrEqual(44)
        expect(box.width, name).toBeGreaterThanOrEqual(44)
      }
      await page.getByRole('searchbox', { name: SEARCH_SONGS }).fill('zzz')
      await expect.element(control(MORE_ACTIONS)).not.toBeInTheDocument()
      for (const name of ['Filters', ADD_SONG]) {
        const box = buttonHost(name).getBoundingClientRect()
        expect(box.height, name).toBeGreaterThanOrEqual(44)
        expect(box.width, name).toBeGreaterThanOrEqual(44)
      }
    } finally {
      await page.viewport(390, 844)
    }
  })
})
