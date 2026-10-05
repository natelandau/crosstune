import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { CrosstuneDb } from '../../db/schema'
import type { SyncEngine } from '../../sync/types'
import { openTestDb } from '../../test/db'
import { renderScreen } from '../../test/ionic'
import { fakeEngine } from '../../test/providers'
import { playEventRow, practiceSessionRow, tuneRow, userTuneRow } from '../../test/rows'
import { MORE_ACTIONS } from '../../ui/Menu'
import { A_TO_Z, NEWEST_FIRST, OLDEST_FIRST, SORT_BY } from '../../ui/sortCopy'
import { CANCEL_SELECTION } from '../selection/SelectionToolbar'
import { CatalogPage } from './CatalogPage'
import { CATALOG_SORT_LABELS } from './catalogSort'

// The button is named for the current sort, "Sort by Title, A to Z".
const SORT_BUTTON = new RegExp(`^${SORT_BY} `)

let db: CrosstuneDb

beforeEach(async () => {
  db = openTestDb()
  // The sort choice is held in memory once read; a cleared-storage event resets it to the
  // default, which is what a fresh device shows.
  localStorage.clear()
  window.dispatchEvent(new StorageEvent('storage', { key: null }))
  await db.tunes.bulkPut([
    tuneRow('t-joy', "Soldier's Joy"),
    tuneRow('t-hen', 'Cluck Old Hen'),
    tuneRow('t-sally', 'Sally Ann'),
  ])
  await db.user_tunes.bulkPut([
    userTuneRow('u-joy', 't-joy', { created_at: '2026-03-01T00:00:00.000Z' }),
    userTuneRow('u-hen', 't-hen', { created_at: '2026-01-01T00:00:00.000Z' }),
    userTuneRow('u-sally', 't-sally', { created_at: '2026-05-01T00:00:00.000Z' }),
  ])
})

const show = (engine: SyncEngine = fakeEngine()) =>
  renderScreen(<CatalogPage />, { db, path: '/catalog', engine })
const sortButton = () => page.getByRole('button', { name: SORT_BUTTON })
const titles = () =>
  Array.from(document.querySelectorAll('ion-list h2'), (heading) => heading.textContent)
const hostOf = (element: Element) => (element.getRootNode() as ShadowRoot).host

async function pickSort(label: string) {
  await sortButton().click()
  await page.getByRole('menuitemradio', { name: label }).click()
  await expect.poll(() => document.querySelector('ion-popover:not(.overlay-hidden)')).toBeNull()
}

describe('catalog sort', () => {
  it('lists the tunes by title until another sort is picked', async () => {
    show()
    await expect.poll(titles).toEqual(['Cluck Old Hen', 'Sally Ann', "Soldier's Joy"])
  })

  it('puts Sort at the trailing edge of the list header, out of the toolbar', async () => {
    show()
    await expect.element(sortButton()).toBeVisible()
    const header = () => hostOf(sortButton().element()).closest('[data-list-header]')
    await expect.poll(header).not.toBeNull()
    expect(hostOf(sortButton().element()).closest('ion-toolbar')).toBeNull()
    await expect.element(page.getByText('3 tunes')).toBeVisible()
    await vi.waitFor(() => {
      const sortBox = hostOf(sortButton().element()).getBoundingClientRect()
      const headerBox = header()!.getBoundingClientRect()
      const firstRow = document.querySelector('ion-list ion-item')!.getBoundingClientRect()
      expect(sortBox.width).toBeGreaterThanOrEqual(44)
      expect(sortBox.height).toBeGreaterThanOrEqual(44)
      expect(headerBox.bottom).toBeLessThanOrEqual(firstRow.top + 1)
    })
  })

  it('names the current sort and its direction on the button', async () => {
    show()
    const named = (name: string) => page.getByRole('button', { name })
    await expect.element(named(`${SORT_BY} ${CATALOG_SORT_LABELS.title}, ${A_TO_Z}`)).toBeVisible()
    await pickSort(CATALOG_SORT_LABELS.added)
    await expect
      .element(named(`${SORT_BY} ${CATALOG_SORT_LABELS.added}, ${NEWEST_FIRST}`))
      .toBeVisible()
  })

  it('orders by date added, newest first, and reverses on a second pick', async () => {
    show()
    await expect.poll(titles).toHaveLength(3)
    await pickSort(CATALOG_SORT_LABELS.added)
    await expect.poll(titles).toEqual(['Sally Ann', "Soldier's Joy", 'Cluck Old Hen'])
    await pickSort(CATALOG_SORT_LABELS.added)
    await expect.poll(titles).toEqual(['Cluck Old Hen', "Soldier's Joy", 'Sally Ann'])
  })

  it('names the direction on the checked item, in date words for a date sort', async () => {
    show()
    const checked = () => {
      const item = document.querySelector('ion-popover:not(.overlay-hidden) [aria-checked="true"]')
      return item
        ? [
            item.querySelector('[data-menu-label]')?.textContent,
            item.getAttribute('aria-description'),
          ]
        : null
    }
    await pickSort(CATALOG_SORT_LABELS.modified)
    await sortButton().click()
    await expect.poll(checked).toEqual([CATALOG_SORT_LABELS.modified, NEWEST_FIRST])
    await page.getByRole('menuitemradio', { name: CATALOG_SORT_LABELS.modified }).click()
    await expect.poll(() => document.querySelector('ion-popover:not(.overlay-hidden)')).toBeNull()
    await sortButton().click()
    await expect.poll(checked).toEqual([CATALOG_SORT_LABELS.modified, OLDEST_FIRST])
  })

  it('orders by last played from history it pulls, never-played tunes last', async () => {
    await db.practice_sessions.put(
      practiceSessionRow('p1', { tune_id: 't-joy', started_at: '2026-09-01T00:00:00.000Z' }),
    )
    // The play for Sally Ann is on the server only, until the events pull brings it down.
    const engine = fakeEngine({
      pullEvents: async () => {
        await db.play_events.put(
          playEventRow('e1', { tune_id: 't-sally', started_at: '2026-10-01T00:00:00.000Z' }),
        )
      },
    })
    show(engine)
    await expect.poll(titles).toHaveLength(3)
    await pickSort(CATALOG_SORT_LABELS.played)
    await expect.poll(titles).toEqual(['Sally Ann', "Soldier's Joy", 'Cluck Old Hen'])
  })

  it('leaves the history on the server under every other sort', async () => {
    const pullEvents = vi.fn(async () => {})
    show(fakeEngine({ pullEvents }))
    await expect.poll(titles).toHaveLength(3)
    await pickSort(CATALOG_SORT_LABELS.added)
    await pickSort(CATALOG_SORT_LABELS.modified)
    await pickSort(CATALOG_SORT_LABELS.title)
    await expect.poll(titles).toEqual(['Cluck Old Hen', 'Sally Ann', "Soldier's Joy"])
    expect(pullEvents).not.toHaveBeenCalled()
  })

  it('hides Sort while selecting', async () => {
    show()
    await expect.element(sortButton()).toBeVisible()
    await page.getByRole('button', { name: MORE_ACTIONS }).click()
    // A plain menu item is an ion-item, with no menu role to find it by.
    const select = await vi.waitFor(() => {
      const items = document.querySelectorAll<HTMLElement>(
        'ion-popover:not(.overlay-hidden) ion-item',
      )
      const found = Array.from(items).find((item) => item.textContent?.trim() === 'Select')
      expect(found, 'no Select item').toBeTruthy()
      return found!
    })
    select.click()
    await expect.element(page.getByRole('button', { name: CANCEL_SELECTION })).toBeVisible()
    await expect.poll(() => sortButton().elements().length).toBe(0)
    await page.getByRole('button', { name: CANCEL_SELECTION }).click()
    await expect.element(sortButton()).toBeVisible()
  })
})
