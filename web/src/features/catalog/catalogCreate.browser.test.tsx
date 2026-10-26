import { page, userEvent } from 'vitest/browser'
import { afterEach, expect, it } from 'vitest'
import { addToList, createList } from '../../commands/lists'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { addTypedTitleLabel, SEARCH_TUNES } from './catalogCopy'
import { clearFresh } from '../tune/freshTune'
import { addedMessage, keptMessage, NOTES_SECTION } from '../tune/tuneScreenCopy'
import { TUNE } from '../tune/tunePageCopy'
import { openTestDb } from '../../test/db'
import { renderApp } from '../../test/renderApp'
import { destination } from '../../layout/destinations'
import { recordingRow } from '../../test/rows'
import { UNDO } from '../../ui/Toast'

afterEach(clearFresh)

const TITLE = "Elzic's Farewell"

const search = () => page.getByRole('searchbox', { name: SEARCH_TUNES })
const tunePage = () => page.getByRole('main', { name: TUNE })
const toast = () => page.getByRole('status').getByText(addedMessage(TITLE))
const undo = () => page.getByRole('status').getByRole('button', { name: UNDO })

async function created(db: CrosstuneDb) {
  const [tune] = await db.tunes.where('title').equals(TITLE).toArray()
  return tune
}

/** Creates the tune from the search's add row and waits for its page. */
async function createFromSearch() {
  const db = openTestDb()
  await createTune(db, { title: 'Forked Deer' }, { status: 'known' })
  const app = await renderApp({ path: '/catalog', db })
  await search().fill(TITLE)
  await page
    .getByRole('button', {
      name: addTypedTitleLabel({ kind: 'create', title: TITLE, another: false }),
    })
    .click()
  await expect.poll(() => created(db)).toBeDefined()
  const tuneId = (await created(db))!.id
  await expect.poll(() => app.router.state.location.pathname).toBe(`/catalog/${tuneId}`)
  await expect.element(tunePage().getByRole('heading', { level: 1, name: TITLE })).toBeVisible()
  await expect.element(toast()).toBeVisible()
  // Held under the pointer, so the toast outlives a slow runner's countdown.
  await toast().hover()
  return { ...app, db, tuneId }
}

it('the add row creates the tune and opens its page, with Undo', async () => {
  await createFromSearch()
  await expect.element(undo()).toBeVisible()
})

it('creates the tune on Enter as the add row does', async () => {
  const db = openTestDb()
  await createTune(db, { title: 'Forked Deer' }, { status: 'known' })
  const { router } = await renderApp({ path: '/catalog', db })
  await search().fill(TITLE)
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => created(db)).toBeDefined()
  const tuneId = (await created(db))!.id
  await expect.poll(() => router.state.location.pathname).toBe(`/catalog/${tuneId}`)
  await expect.element(toast()).toBeVisible()
})

it('Undo deletes the new tune and returns to the catalog', async () => {
  const { db, router, tuneId } = await createFromSearch()
  await undo().click()
  await expect.poll(async () => (await db.tunes.get(tuneId))?.deleted_at).toBeTruthy()
  await expect.poll(() => router.state.location.pathname).toBe('/catalog')
})

it('recording a take on the new tune drops Undo', async () => {
  const { db, tuneId } = await createFromSearch()
  await db.recordings.put(recordingRow('r1', { tune_id: tuneId, label: 'Fast take' }))
  await expect.element(undo()).not.toBeInTheDocument()
  await expect.element(toast()).toBeVisible()
})

it('typing notes on the new tune drops Undo', async () => {
  await createFromSearch()
  await tunePage().getByRole('textbox', { name: NOTES_SECTION }).fill('Learned from Dad')
  await expect.element(undo()).not.toBeInTheDocument()
  await expect.element(toast()).toBeVisible()
})

it('Undo keeps a tune that gained work after its page was left', async () => {
  const { db, router, tuneId } = await createFromSearch()
  const listId = await createList(db, 'Tuesday jam')
  await tunePage()
    .getByRole('link', { name: destination('catalog').label })
    .click()
  await expect.poll(() => router.state.location.pathname).toBe('/catalog')
  const userTune = await db.user_tunes.where('tune_id').equals(tuneId).first()
  await addToList(db, listId, userTune!.id)
  await toast().hover()
  await undo().click()
  await expect.element(undo()).not.toBeInTheDocument()
  await expect.element(page.getByRole('status').getByText(keptMessage(TITLE))).toBeVisible()
  await expect.poll(() => db.tunes.get(tuneId)).toMatchObject({ deleted_at: null })
  const items = await db.list_items.where('user_tune_id').equals(userTune!.id).toArray()
  expect(items.filter((item) => !item.deleted_at)).toHaveLength(1)
  expect(router.state.location.pathname).toBe('/catalog')
})
