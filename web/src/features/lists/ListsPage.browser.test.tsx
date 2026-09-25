import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { addToList, createList } from '../../commands/lists'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { MOUSE_QUERY } from '../../platform/pointer'
import { openTestDb } from '../../test/db'
import { renderScreen } from '../../test/ionic'
import { fakeEngine } from '../../test/providers'
import { DELETE_LIST_MESSAGE } from './deleteListMessage'
import { LIST_NAME_LABEL } from './ListNameSheet'
import { ADD_LIST, ListsPage, NO_LISTS_HINT, NO_LISTS_TITLE } from './ListsPage'

let db: CrosstuneDb
const original = window.matchMedia

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  window.matchMedia = original
  await db.delete()
})

const show = (engine = fakeEngine()) =>
  renderScreen(<ListsPage />, { db, engine, path: '/lists', route: '/lists' })

describe('ListsPage', () => {
  it('names the empty state and creates the first list from it', async () => {
    show()
    await expect.element(page.getByText(NO_LISTS_TITLE)).toBeVisible()
    await expect.element(page.getByText(NO_LISTS_HINT)).toBeVisible()
    await page.getByRole('button', { name: ADD_LIST }).last().click()
    await page.getByLabelText(LIST_NAME_LABEL).fill('Tuesday jam')
    await page.getByRole('button', { name: 'Create', exact: true }).click()
    await expect.element(page.getByRole('heading', { name: 'Tuesday jam' })).toBeVisible()
  })

  it('lists lists in position order with counts', async () => {
    const jam = await createList(db, 'Tuesday jam')
    await createList(db, 'Square dance set')
    const { userTuneId } = await createTune(db, { title: "Soldier's Joy" }, { status: 'known' })
    await addToList(db, jam, userTuneId)
    show()
    await expect.element(page.getByText('1 tune · Edited today')).toBeVisible()
    const names = Array.from(document.querySelectorAll('ion-list h2')).map((h) => h.textContent)
    expect(names).toEqual(['Tuesday jam', 'Square dance set'])
  })

  it('renames a list from its row', async () => {
    const jam = await createList(db, 'Tuesday jam')
    show()
    await page.getByRole('button', { name: 'Edit Tuesday jam' }).click()
    await expect.element(page.getByLabelText(LIST_NAME_LABEL)).toHaveValue('Tuesday jam')
    await page.getByLabelText(LIST_NAME_LABEL).fill('Wednesday jam')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await vi.waitFor(async () => expect((await db.lists.get(jam))?.name).toBe('Wednesday jam'))
  })

  it('deletes a list only after confirming, naming what stays', async () => {
    const jam = await createList(db, 'Tuesday jam')
    show()
    await page.getByRole('button', { name: 'Delete Tuesday jam' }).click()
    await expect.element(page.getByText(DELETE_LIST_MESSAGE)).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
    expect((await db.lists.get(jam))?.deleted_at).toBeNull()
    await page.getByRole('button', { name: 'Delete Tuesday jam' }).click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await vi.waitFor(async () => expect((await db.lists.get(jam))?.deleted_at).not.toBeNull())
  })

  it('pulls to refresh on touch and completes the refresher', async () => {
    window.matchMedia = (query: string) =>
      query === MOUSE_QUERY
        ? ({
            matches: false,
            media: query,
            addEventListener() {},
            removeEventListener() {},
          } as unknown as MediaQueryList)
        : original.call(window, query)
    const engine = fakeEngine()
    const sync = vi.spyOn(engine, 'sync')
    show(engine)
    await expect.element(page.getByText(NO_LISTS_TITLE)).toBeVisible()
    const refresher = document.querySelector('ion-refresher')!
    expect(refresher.parentElement?.tagName).toBe('ION-CONTENT')
    const complete = vi.fn()
    refresher.dispatchEvent(new CustomEvent('ionRefresh', { detail: { complete } }))
    await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce())
    expect(sync).toHaveBeenCalledOnce()
  })

  it('has one level 1 heading while loading and when loaded', async () => {
    show()
    await vi.waitFor(() => expect(document.querySelectorAll('h1')).toHaveLength(1))
    await expect.element(page.getByText(NO_LISTS_TITLE)).toBeVisible()
    expect(document.querySelectorAll('h1')).toHaveLength(1)
  })

  it('walks the rows with the arrow keys on a mouse', async () => {
    await createList(db, 'Tuesday jam')
    await createList(db, 'Square dance set')
    show()
    await expect.element(page.getByRole('heading', { name: 'Square dance set' })).toBeVisible()
    const opens = document.querySelectorAll<HTMLElement>('[data-row-open]')
    expect(opens).toHaveLength(2)
    await vi.waitFor(() => {
      opens[0]!.focus()
      expect(document.activeElement).toBe(opens[0])
    })
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(opens[1])
    await userEvent.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(opens[0])
  })
})
