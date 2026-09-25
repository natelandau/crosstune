import { IonButton } from '@ionic/react'
import { useMemo, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { addToList, createList } from '../../commands/lists'
import { LIST_NOT_FOUND } from '../../commands/messages'
import { createTune, setArchived } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { SEARCH_TUNES } from '../catalog/TuneSearch'
import { ADD_TUNES, IN_THIS_LIST, PICKER_HINT, TunePickerSheet } from './TunePickerSheet'
import { useListView } from './useLists'

vi.mock('../../commands/lists', { spy: true })

let db: CrosstuneDb
let listId: string
let joy: { tuneId: string; userTuneId: string }
let hen: { tuneId: string; userTuneId: string }

beforeEach(async () => {
  db = openTestDb()
  listId = await createList(db, 'Tuesday jam')
  joy = await createTune(db, { title: "Soldier's Joy", key: 'D' }, { status: 'known' })
  hen = await createTune(db, { title: 'Cluck Old Hen', key: 'A' }, { status: 'learning' })
})

/** Stands in for the list screen: it owns the list query and reopens the sheet. */
function Host({ onCreate = () => {} }: { onCreate?: (title: string) => void }) {
  const [open, setOpen] = useState(true)
  const view = useListView(listId)
  const items = view?.items
  const taken = useMemo(() => new Set(items ? items.map((item) => item.userTune.id) : []), [items])
  return (
    <>
      <IonButton onClick={() => setOpen(true)}>Open picker</IonButton>
      <TunePickerSheet
        open={open}
        listId={listId}
        taken={taken}
        onClose={() => setOpen(false)}
        onCreate={onCreate}
      />
    </>
  )
}

const itemsIn = async () =>
  (await db.list_items.where('list_id').equals(listId).toArray()).filter((i) => !i.deleted_at)
const search = () => page.getByRole('searchbox', { name: SEARCH_TUNES })

describe('TunePickerSheet', () => {
  it('hints before a search and adds a picked tune, staying open with a cleared search', async () => {
    renderIonic(<Host />, { db })
    await expect.element(page.getByText(PICKER_HINT)).toBeVisible()
    await search().fill('cluck')
    await page.getByRole('button', { name: 'Add Cluck Old Hen' }).click()
    await vi.waitFor(async () => expect(await itemsIn()).toHaveLength(1))
    await expect.element(search()).toHaveValue('')
    await expect.element(page.getByText(ADD_TUNES)).toBeVisible()
  })

  it('shows a tune already in the list without offering it', async () => {
    await addToList(db, listId, joy.userTuneId)
    renderIonic(<Host />, { db })
    await search().fill('soldier')
    await expect.element(page.getByText(IN_THIS_LIST)).toBeVisible()
    expect(page.getByRole('button', { name: "Add Soldier's Joy" }).elements()).toHaveLength(0)
  })

  it('starts every result title on the same line, taken or offered', async () => {
    await addToList(db, listId, joy.userTuneId)
    renderIonic(<Host />, { db })
    // Both titles carry an "o", so one search shows a taken row and an offered one together.
    await search().fill('o')
    await expect.element(page.getByText(IN_THIS_LIST)).toBeVisible()
    // An offered row keeps its lines out of the accessibility tree, so the titles are read
    // from the DOM rather than by role.
    const titles = Array.from(document.querySelectorAll('ion-modal ion-item h2'))
    expect(titles.map((title) => title.textContent)).toContain('Cluck Old Hen')
    const lefts = new Set(titles.map((title) => title.getBoundingClientRect().left))
    expect(lefts.size).toBe(1)
  })

  it('finds archived tunes and says so in the row name', async () => {
    await setArchived(db, hen.userTuneId, true)
    renderIonic(<Host />, { db })
    await search().fill('cluck')
    await expect
      .element(page.getByRole('button', { name: 'Add Cluck Old Hen, archived' }))
      .toBeVisible()
    expect(page.getByRole('button', { name: 'Add Cluck Old Hen' }).elements()).toHaveLength(0)
  })

  it('adds the only match from Enter, and does nothing for a lone match already in the list', async () => {
    renderIonic(<Host />, { db })
    await search().fill('cluck')
    await userEvent.keyboard('{Enter}')
    await vi.waitFor(async () => expect(await itemsIn()).toHaveLength(1))
    await search().fill('cluck')
    // Only the live query's view of the list stops the second Enter, so wait for it to land.
    await expect.element(page.getByText(IN_THIS_LIST)).toBeVisible()
    await userEvent.keyboard('{Enter}')
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    expect(await itemsIn()).toHaveLength(1)
    // addToList is idempotent, so only the spy shows the second Enter did nothing at all.
    expect(vi.mocked(addToList)).toHaveBeenCalledOnce()
  })

  it('offers to create a tune by the typed title and hands it to the caller', async () => {
    const onCreate = vi.fn()
    renderIonic(<Host onCreate={onCreate} />, { db })
    await search().fill('Sally Goodin')
    await expect.element(page.getByText('No tune called "Sally Goodin"')).toBeVisible()
    await page.getByRole('button', { name: 'Add "Sally Goodin"' }).click()
    await vi.waitFor(() => expect(onCreate).toHaveBeenCalledWith('Sally Goodin'))
  })

  it('offers nothing while the catalog is still being read', async () => {
    const onCreate = vi.fn()
    // The sheet starts its catalog query when it opens, so a query typed before that read lands
    // must not be answered as though the catalog held no such tune.
    vi.spyOn(db.tunes, 'toArray').mockReturnValue(new Promise(() => {}) as never)
    renderIonic(<Host onCreate={onCreate} />, { db })
    await search().fill("Soldier's Joy")
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(page.getByText('No tune called "Soldier\'s Joy"').elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: 'Add "Soldier\'s Joy"' }).elements()).toHaveLength(0)
    await userEvent.keyboard('{Enter}')
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(onCreate).not.toHaveBeenCalled()
    expect(await itemsIn()).toHaveLength(0)
  })

  it('creates from Enter when nothing matches', async () => {
    const onCreate = vi.fn()
    renderIonic(<Host onCreate={onCreate} />, { db })
    await search().fill('Sally Goodin')
    await userEvent.keyboard('{Enter}')
    await vi.waitFor(() => expect(onCreate).toHaveBeenCalledWith('Sally Goodin'))
  })

  it('adds a tune once from two taps in the same tick', async () => {
    renderIonic(<Host />, { db })
    await search().fill('cluck')
    const add = page.getByRole('button', { name: 'Add Cluck Old Hen' })
    await expect.element(add).toBeVisible()
    // The item's native button lives in a shadow root, so only a composed click leaves it.
    add.element().dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
    add.element().dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
    await vi.waitFor(async () => expect(await itemsIn()).toHaveLength(1))
    expect(vi.mocked(addToList)).toHaveBeenCalledOnce()
  })

  it('toasts a rejection that lands after the sheet has closed', async () => {
    let fail = (_error: Error) => {}
    vi.mocked(addToList).mockReturnValueOnce(
      new Promise<string>((_resolve, reject) => {
        fail = reject
      }),
    )
    renderIonic(<Host />, { db })
    await search().fill('cluck')
    await page.getByRole('button', { name: 'Add Cluck Old Hen' }).click()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await vi.waitFor(() =>
      expect(document.querySelector('ion-modal:not(.overlay-hidden)')).toBeNull(),
    )
    fail(new Error(LIST_NOT_FOUND))
    await expect.element(page.getByText(LIST_NOT_FOUND)).toBeVisible()
  })

  it('keeps a rejection from an earlier visit off the next visit error line', async () => {
    let fail = (_error: Error) => {}
    vi.mocked(addToList).mockReturnValueOnce(
      new Promise<string>((_resolve, reject) => {
        fail = reject
      }),
    )
    renderIonic(<Host />, { db })
    await search().fill('cluck')
    await page.getByRole('button', { name: 'Add Cluck Old Hen' }).click()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await vi.waitFor(() =>
      expect(document.querySelector('ion-modal:not(.overlay-hidden)')).toBeNull(),
    )
    await page.getByRole('button', { name: 'Open picker' }).click()
    await expect.element(search()).toBeVisible()
    // A second add in the new visit, which is what used to tell the sheet it was back on screen.
    await search().fill('soldier')
    await page.getByRole('button', { name: "Add Soldier's Joy" }).click()
    await vi.waitFor(async () => expect(await itemsIn()).toHaveLength(1))
    fail(new Error(LIST_NOT_FOUND))
    await expect.element(page.getByText(LIST_NOT_FOUND)).toBeVisible()
    expect(document.querySelectorAll('ion-modal [role="alert"]')).toHaveLength(0)
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await vi.waitFor(() =>
      expect(document.querySelector('ion-modal:not(.overlay-hidden)')).toBeNull(),
    )
  })

  it('closes from Done', async () => {
    renderIonic(<Host />, { db })
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await vi.waitFor(() =>
      expect(document.querySelector('ion-modal:not(.overlay-hidden)')).toBeNull(),
    )
  })
})
