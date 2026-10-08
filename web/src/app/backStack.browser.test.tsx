import { page } from 'vitest/browser'
import { expect, it } from 'vitest'
import { RECORD_LABEL } from './tabs'
import { addToList, createList } from '../commands/lists'
import { createTune } from '../commands/tunes'
import type { CrosstuneDb } from '../db/schema'
import { ADD_TUNE, TUNE_LIST, SELECT_TUNES } from '../features/catalog/catalogCopy'
import { PAUSE } from '../features/player/transportCopy'
import { DISCARD_TITLE, NEW_RECORDING } from '../features/recording/recordCopy'
import { TRIM } from '../features/practice/trimCopy'
import { START_HANDLE } from '../features/practice/TrimStrip'
import { DETAIL_LABELS } from '../features/tune/detailFields'
import { NEW_TUNE_TITLE, TITLE_FIELD } from '../features/tune/tuneFormCopy'
import { openTestDb } from '../test/db'
import { FakeRecorder, fakeMediaForTest } from '../test/fakeMedia'
import { NOT_SET } from '../ui/fieldCopy'
import { MORE_ACTIONS } from '../ui/menuCopy'

import { useAndroidBackForTest } from '../test/androidBack'
import { tap } from '../test/gestures'
import { mountPlaying, openPractice, player, practice, TAKE } from '../test/practice'
import { renderApp } from '../test/renderApp'
import { SELECTION_ACTIONS } from '../features/selection/selectionCopy'

const PHONE = { width: 390, height: 844 }
const WIDE = { width: 1280, height: 800 }

const path = (router: { state: { location: { pathname: string } } }) => () =>
  router.state.location.pathname

/** A list holding two tunes, returning its id. */
async function seedList(db: CrosstuneDb): Promise<string> {
  const listId = await createList(db, 'Thursday jam')
  for (const title of ['Cluck Old Hen', 'Forked Deer']) {
    const { userTuneId } = await createTune(db, { title }, { status: 'learning' })
    await addToList(db, listId, userTuneId)
  }
  return listId
}

it('closes a menu, then ends selection, then goes back, then exits at the root', async () => {
  const android = useAndroidBackForTest()
  const db = openTestDb()
  const listId = await seedList(db)
  const { router } = await renderApp({
    path: '/catalog',
    db,
    frame: PHONE,
    density: 'touch',
    android,
  })
  await router.navigate(`/lists/${listId}`)
  const rows = page.getByRole('grid', { name: TUNE_LIST })
  const row = rows.getByRole('row', { name: /Forked Deer/ })
  await expect.element(row).toBeVisible()
  await page.getByRole('button', { name: MORE_ACTIONS }).click()
  await page.getByRole('menuitem', { name: SELECT_TUNES }).click()
  const bar = page.getByRole('toolbar', { name: SELECTION_ACTIONS })
  await expect.element(bar).toBeVisible()
  // Rows hold no menu while selecting, so the bar's More is the menu over selection.
  await tap(row)
  await expect.element(row).toHaveAttribute('aria-selected', 'true')
  await bar.getByRole('button', { name: MORE_ACTIONS }).click()
  const menu = page.getByRole('menu')
  await expect.element(menu).toBeVisible()

  expect(android.press()).toMatchObject({ kind: 'entry', entry: { layer: 'overlay' } })
  await expect.element(menu).not.toBeInTheDocument()
  await expect.element(bar).toBeVisible()

  expect(android.press()).toMatchObject({ kind: 'entry', entry: { layer: 'screen' } })
  await expect.element(bar).not.toBeInTheDocument()
  expect(path(router)()).toBe(`/lists/${listId}`)

  expect(android.press()).toEqual({ kind: 'history' })
  await expect.poll(path(router)).toBe('/catalog')
  expect(android.exits()).toBe(0)

  expect(android.press()).toEqual({ kind: 'exit' })
  expect(android.exits()).toBe(1)
  expect(path(router)()).toBe('/catalog')
})

it('keeps a tune form holding typed work open on back', async () => {
  const android = useAndroidBackForTest()
  const db = openTestDb()
  await createTune(db, { title: 'Cluck Old Hen' }, { status: 'learning' })
  await renderApp({ path: '/catalog', db, frame: PHONE, density: 'touch', android })
  await page.getByRole('button', { name: ADD_TUNE }).first().click()
  const form = page.getByRole('dialog', { name: NEW_TUNE_TITLE })
  const title = form.getByRole('textbox', { name: TITLE_FIELD })
  await title.fill('Forked Deer')

  expect(android.press()).toEqual({ kind: 'refused' })
  await expect.element(form).toBeVisible()
  await expect.element(title).toHaveValue('Forked Deer')
  expect(android.exits()).toBe(0)
})

it("closes a field's suggestions, then the form holding no typed work", async () => {
  const android = useAndroidBackForTest()
  const db = openTestDb()
  await createTune(db, { title: 'Cluck Old Hen' }, { status: 'learning' })
  await renderApp({ path: '/catalog', db, frame: PHONE, density: 'touch', android })
  await page.getByRole('button', { name: ADD_TUNE }).first().click()
  const form = page.getByRole('dialog', { name: NEW_TUNE_TITLE })
  await form.getByRole('combobox', { name: DETAIL_LABELS.composer }).click()
  const suggestions = page.getByRole('option', { name: NOT_SET, exact: true })
  await expect.element(suggestions).toBeVisible()

  expect(android.press()).toMatchObject({ kind: 'entry', entry: { layer: 'overlay' } })
  await expect.element(suggestions).not.toBeInTheDocument()
  await expect.element(form).toBeVisible()

  expect(android.press()).toMatchObject({ kind: 'entry', entry: { layer: 'overlay' } })
  await expect.element(form).not.toBeInTheDocument()
})

it('asks before back discards a live recording, and keeps recording when declined', async () => {
  fakeMediaForTest()
  const android = useAndroidBackForTest()
  const db = openTestDb()
  await renderApp({ path: '/catalog', db, frame: PHONE, density: 'touch', android })
  await page.getByRole('button', { name: RECORD_LABEL }).click()
  const sheet = page.getByRole('dialog', { name: NEW_RECORDING })
  await expect.element(sheet.getByRole('timer')).toBeVisible()

  expect(android.press()).toMatchObject({ kind: 'entry', entry: { layer: 'overlay' } })
  const question = page.getByRole('dialog', { name: DISCARD_TITLE })
  await expect.element(question).toBeVisible()

  expect(android.press()).toMatchObject({ kind: 'entry', entry: { layer: 'overlay' } })
  await expect.element(question).not.toBeInTheDocument()
  await expect.element(sheet).toBeVisible()
  expect(FakeRecorder.instances[0]?.state).toBe('recording')
  expect(await db.recordings.count()).toBe(0)
})

it('closes practice on back, still playing', async () => {
  const android = useAndroidBackForTest()
  const { engine } = await mountPlaying(PHONE, { android, density: 'touch' })
  await openPractice()

  expect(android.press()).toMatchObject({ kind: 'entry', entry: { layer: 'overlay' } })
  await expect.poll(practice).toBeNull()
  await expect.element(player().getByRole('button', { name: PAUSE })).toBeVisible()
  expect(engine.getState().playing).toBe(true)
})

it('steps back from trim to practice, which stays open', async () => {
  const android = useAndroidBackForTest()
  const { engine } = await mountPlaying(WIDE, { android })
  await openPractice()
  const take = page.getByRole('dialog', { name: TAKE })
  await take.getByRole('button', { name: MORE_ACTIONS }).click()
  await page.getByRole('menuitem', { name: TRIM }).click()
  const handle = page.getByRole('slider', { name: START_HANDLE })
  await expect.element(handle).toBeVisible()
  await expect.poll(() => engine.getState().lengthMs).toBeGreaterThan(0)

  expect(android.press()).toMatchObject({ kind: 'entry', entry: { layer: 'overlay' } })
  await expect.element(handle).not.toBeInTheDocument()
  await expect.element(take.getByRole('button', { name: MORE_ACTIONS })).toBeVisible()
  expect(practice()).not.toBeNull()
})

it("closes a picker's list on pointer and leaves the form under it open", async () => {
  const android = useAndroidBackForTest()
  const db = openTestDb()
  await createTune(db, { title: 'Cluck Old Hen' }, { status: 'learning' })
  await renderApp({ path: '/catalog', db, frame: WIDE, density: 'pointer', android })
  await page.getByRole('button', { name: ADD_TUNE }).first().click()
  const form = page.getByRole('dialog', { name: NEW_TUNE_TITLE })
  await form.getByRole('button', { name: new RegExp(DETAIL_LABELS.time_signature) }).click()
  const list = page.getByRole('option', { name: '6/8', exact: true })
  await expect.element(list).toBeVisible()

  expect(android.press()).toMatchObject({ kind: 'entry', entry: { layer: 'overlay' } })
  await expect.element(list).not.toBeInTheDocument()
  await expect.element(form).toBeVisible()
})
