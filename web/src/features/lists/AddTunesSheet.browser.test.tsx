import { page } from 'vitest/browser'
import { expect, it } from 'vitest'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { renderWithProviders } from '../../test/render'
import { scrollerOf } from '../../test/scroller'
import { tuneRow, userTuneRow } from '../../test/rows'
import { pickRowName, SEARCH_TUNES } from '../catalog/catalogCopy'
import { ADD_TUNES, addTuneName, IN_THIS_LIST, PICKER_HINT } from './listsCopy'
import { AddTunesSheet } from './AddTunesSheet'
import { TuneFormProvider } from '../tune/TuneFormProvider'
import { createList } from '../../commands/lists'
import { DONE } from '../../ui/confirmCopy'
import { recordingAnalytics } from '../../usage/testing'

const BIG = 2000

async function mountPicker(tunes: { title: string; archived?: boolean }[], inList: string[] = []) {
  const db = openTestDb()
  await db.tunes.bulkPut(tunes.map((t, i) => tuneRow(`t${i}`, t.title)))
  await db.user_tunes.bulkPut(
    tunes.map((t, i) =>
      userTuneRow(`u${i}`, `t${i}`, {
        archived_at: t.archived ? '2026-02-01T00:00:00.000Z' : null,
      }),
    ),
  )
  const listId = await createList(db, 'Tuesday jam')
  const taken = new Set(tunes.flatMap((t, i) => (inList.includes(t.title) ? [`u${i}`] : [])))
  const analytics = recordingAnalytics()
  const Data = dataProviders({ db, analytics })
  renderWithProviders(
    <Data>
      <TuneFormProvider>
        <AddTunesSheet listId={listId} taken={taken} isOpen onOpenChange={() => {}} />
      </TuneFormProvider>
    </Data>,
  )
  const dialog = page.getByRole('dialog', { name: ADD_TUNES })
  await expect.element(dialog).toBeVisible()
  return { dialog, db, listId, analytics }
}

const titles = (dialog: ReturnType<typeof page.getByRole>) =>
  dialog
    .getByRole('row')
    .elements()
    .map((row) => row.textContent ?? '')

it('lists every tune A to Z before typing', async () => {
  const { dialog } = await mountPicker([
    { title: 'Zebra Reel' },
    { title: 'élan Jig' },
    { title: 'Banjo Rag' },
    { title: 'apple Hornpipe' },
  ])
  await expect
    .poll(() =>
      titles(dialog).map((text) =>
        ['Zebra', 'lan', 'Banjo', 'apple'].find((k) => text.includes(k)),
      ),
    )
    .toEqual(['apple', 'Banjo', 'lan', 'Zebra'])
  await expect.element(dialog.getByRole('searchbox', { name: SEARCH_TUNES })).toBeVisible()
})

it('adds a pick, keeps the search focused for the next, and reports the visit on Done', async () => {
  const { dialog, db, listId, analytics } = await mountPicker([
    { title: 'Banjo Rag' },
    { title: 'Cluck Old Hen' },
  ])
  const search = dialog.getByRole('searchbox', { name: SEARCH_TUNES })
  await dialog
    .getByRole('row', { name: pickRowName(addTuneName('Cluck Old Hen'), false), exact: true })
    .click()
  await expect.element(search).toHaveFocus()
  await expect
    .poll(async () => (await db.list_items.where('list_id').equals(listId).toArray()).length)
    .toBe(1)
  await dialog.getByRole('button', { name: DONE }).click()
  await expect
    .poll(() => analytics.sends().filter((send) => send.name === 'tunes_added_to_list'))
    .toEqual([{ name: 'tunes_added_to_list', props: { list_id: listId, count_bucket: '1-9' } }])
})

it('marks a tune already in the list and keeps it inert', async () => {
  const { dialog } = await mountPicker(
    [{ title: 'Banjo Rag' }, { title: 'Cluck Old Hen' }],
    ['Banjo Rag'],
  )
  const row = dialog.getByRole('row', { name: /Banjo Rag/ })
  await expect.element(row).toHaveTextContent(IN_THIS_LIST)
  await expect.element(row).toHaveAttribute('aria-disabled', 'true')
  await expect
    .element(dialog.getByRole('row', { name: /Cluck Old Hen/ }))
    .not.toHaveTextContent(IN_THIS_LIST)
})

it('includes archived tunes', async () => {
  const { dialog } = await mountPicker([
    { title: 'Banjo Rag', archived: true },
    { title: 'Cluck Old Hen' },
  ])
  await expect
    .element(dialog.getByRole('row', { name: pickRowName(addTuneName('Banjo Rag'), true) }))
    .toBeVisible()
})

it('renders a bounded number of rows for 2,000 tunes', async () => {
  const { dialog } = await mountPicker(
    Array.from({ length: BIG }, (_, i) => ({ title: `Tune ${String(i).padStart(4, '0')}` })),
  )
  await expect.element(dialog.getByRole('row').first()).toBeVisible()
  await expect.poll(() => titles(dialog).length).toBeLessThan(100)
  expect(titles(dialog).length).toBeGreaterThan(0)
})

it('says what the picker is for while the catalog is empty', async () => {
  const { dialog } = await mountPicker([])
  await expect.element(dialog.getByText(PICKER_HINT)).toBeVisible()
})

it('scrolls the windowed list', async () => {
  const { dialog } = await mountPicker(
    Array.from({ length: BIG }, (_, i) => ({ title: `Tune ${String(i).padStart(4, '0')}` })),
  )
  const grid = dialog.getByRole('grid')
  await expect.element(grid.getByRole('row').first()).toBeVisible()
  await expect
    .poll(() => {
      const scroller = scrollerOf(grid.element())
      return scroller !== null && scroller.scrollHeight > scroller.clientHeight
    })
    .toBe(true)
})
