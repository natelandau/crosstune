import { beforeEach, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { destination } from '../../layout/destinations'
import { openTestDb } from '../../test/db'
import { renderApp } from '../../test/renderApp'
import { recordingRow } from '../../test/rows'
import { DELETE } from '../../ui/confirmCopy'
import { MORE_ACTIONS } from '../../ui/menuCopy'
import { UNDO } from '../../ui/Toast'
import { AnalyticsProvider } from '../../usage/AnalyticsProvider'
import { recordingAnalytics } from '../../usage/testing'
import { SEARCH_TUNES } from '../catalog/catalogCopy'
import { openTuneName } from './recordingNames'
import { DELETE_WHILE_SPLITTING } from '../practice/splitCopy'
import { SELECT, SELECT_ALL, selectedTitle } from '../selection/selectionCopy'
import {
  addToTuneName,
  deleteRecordingsTitle,
  heldRecordingsLine,
  LINK_TO_TUNE,
  linkedRecordingsToast,
  SELECT_RECORDINGS,
} from './recordingsCopy'

const WIDE = { width: 1280, height: 800 }
const RECORDINGS = destination('recordings')

let db: CrosstuneDb
let analytics: ReturnType<typeof recordingAnalytics>

beforeEach(() => {
  db = openTestDb()
  analytics = recordingAnalytics()
  window.dispatchEvent(new StorageEvent('storage', { key: null }))
})

async function show() {
  await renderApp({
    path: RECORDINGS.root,
    db,
    frame: WIDE,
    wrap: (app) => <AnalyticsProvider client={analytics}>{app}</AnalyticsProvider>,
  })
}

const row = (name: string) => page.getByRole('row', { name: new RegExp(`^${name}`) })
const title = (n: number) => page.getByText(selectedTitle(n), { exact: true })
const sent = (name: string) => analytics.sends().filter((send) => send.name === name)
const tuneOf = async (id: string) => (await db.recordings.get(id))?.tune_id
const deletedAt = async (id: string) => (await db.recordings.get(id))?.deleted_at

async function startSelecting() {
  await page.getByRole('button', { name: MORE_ACTIONS }).click()
  await page.getByRole('menuitem', { name: SELECT_RECORDINGS }).click()
}

it('links an unfiled and a filed recording to one tune with Undo', async () => {
  const a = await createTune(db, { title: 'Cluck Old Hen' }, { status: 'known' })
  const b = await createTune(db, { title: 'Forked Deer' }, { status: 'known' })
  await db.recordings.bulkPut([
    recordingRow('loose', { label: 'Loose take' }),
    recordingRow('filed', { label: 'Filed take', tune_id: a.tuneId }),
  ])
  await show()
  await expect.element(row('Loose take')).toBeVisible()
  await startSelecting()
  await row('Loose take').click()
  await row('Filed take').click()
  await expect.element(title(2)).toBeVisible()

  await page.getByRole('button', { name: LINK_TO_TUNE, exact: true }).click()
  const picker = page.getByRole('dialog', { name: LINK_TO_TUNE })
  await picker.getByRole('searchbox', { name: SEARCH_TUNES }).fill('forked')
  await picker.getByRole('row', { name: addToTuneName('Forked Deer'), exact: true }).click()
  await expect.poll(() => tuneOf('loose')).toBe(b.tuneId)
  await expect.poll(() => tuneOf('filed')).toBe(b.tuneId)
  await expect.element(page.getByText(linkedRecordingsToast(2, 'Forked Deer'))).toBeVisible()
  await expect.element(title(2)).not.toBeInTheDocument()
  await expect
    .poll(() => sent('recording_filed').map((send) => send.props))
    .toEqual([
      { from: 'unfiled', origin: 'recorded', recording_id: 'loose', tune_id: b.tuneId },
      { from: 'other_tune', origin: 'recorded', recording_id: 'filed', tune_id: b.tuneId },
    ])

  await page.getByRole('button', { name: UNDO }).click()
  await expect.poll(() => tuneOf('loose')).toBeNull()
  await expect.poll(() => tuneOf('filed')).toBe(a.tuneId)
})

it('asks before a delete, names the split parent that stays, and keeps it', async () => {
  await db.recordings.bulkPut([
    recordingRow('plain', { label: 'Plain take' }),
    recordingRow('parent', { label: 'Parent take' }),
    recordingRow('piece', {
      label: 'Piece take',
      split_from_id: 'parent',
      state: 'processing',
    }),
  ])
  await show()
  await expect.element(row('Plain take')).toBeVisible()
  await startSelecting()
  await row('Plain take').click()
  await row('Parent take').click()
  await page.getByRole('button', { name: DELETE, exact: true }).click()

  const question = page.getByRole('alertdialog', { name: deleteRecordingsTitle(2) })
  await expect.element(question).toHaveTextContent(heldRecordingsLine(1))
  await question.getByRole('button', { name: DELETE, exact: true }).click()
  await expect.poll(() => deletedAt('plain')).not.toBeNull()
  await expect.element(row('Plain take')).not.toBeInTheDocument()
  await expect.element(title(2)).not.toBeInTheDocument()
  expect(await deletedAt('parent')).toBeNull()
  await expect.element(row('Parent take')).toBeVisible()
  expect(sent('recording_deleted').map((send) => send.props)).toEqual([
    { origin: 'recorded', recording_id: 'plain' },
  ])
})

it('deletes a split parent with its waiting piece and names nothing as staying', async () => {
  await db.recordings.bulkPut([
    recordingRow('parent', { label: 'Parent take' }),
    recordingRow('piece', { label: 'Piece take', split_from_id: 'parent', state: 'processing' }),
  ])
  await show()
  await expect.element(row('Parent take')).toBeVisible()
  await startSelecting()
  await row('Parent take').click()
  await row('Piece take').click()
  await page.getByRole('button', { name: DELETE, exact: true }).click()

  const question = page.getByRole('alertdialog', { name: deleteRecordingsTitle(2) })
  await expect.element(question).toBeVisible()
  await expect.element(question).not.toHaveTextContent(heldRecordingsLine(1))
  await question.getByRole('button', { name: DELETE, exact: true }).click()
  await expect.poll(() => deletedAt('parent')).not.toBeNull()
  await expect.poll(() => deletedAt('piece')).not.toBeNull()
})

it('keeps Delete in the bar, disabled with the reason, while every row is held', async () => {
  await db.recordings.bulkPut([
    recordingRow('parent', { label: 'Parent take' }),
    recordingRow('piece', { label: 'Piece take', split_from_id: 'parent', state: 'processing' }),
  ])
  await show()
  await expect.element(row('Parent take')).toBeVisible()
  await startSelecting()
  await row('Parent take').click()
  const remove = page.getByRole('button', { name: DELETE, exact: true })
  await expect.element(remove).toHaveAttribute('aria-disabled', 'true')
  await expect.element(remove).toHaveAccessibleDescription(DELETE_WHILE_SPLITTING)
  await remove.click({ force: true })
  await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument()
})

it("opens selection from a row's menu, and Escape leaves it", async () => {
  await db.recordings.bulkPut([
    recordingRow('one', { label: 'First take' }),
    recordingRow('two', { label: 'Second take' }),
  ])
  await show()
  await row('First take').click({ button: 'right' })
  await page.getByRole('menuitem', { name: SELECT, exact: true }).click()
  await expect.element(title(1)).toBeVisible()
  await expect.element(row('First take')).toHaveAttribute('aria-selected', 'true')
  await userEvent.keyboard('{Escape}')
  await expect.element(title(1)).not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: MORE_ACTIONS })).toBeVisible()
})

it('returns focus to the section the mode was opened from', async () => {
  const { tuneId } = await createTune(db, { title: 'Cluck Old Hen' }, { status: 'known' })
  await db.recordings.bulkPut([
    recordingRow('loose', { label: 'Loose take' }),
    recordingRow('filed', { label: 'Filed take', tune_id: tuneId }),
  ])
  await show()
  await row('Filed take').click({ button: 'right' })
  await page.getByRole('menuitem', { name: SELECT, exact: true }).click()
  await expect.element(title(1)).toBeVisible()
  // Focus in the bar, which leaves with the mode, so the screen has to put it back.
  await page.getByRole('button', { name: SELECT_ALL, exact: true }).click()
  await expect.element(title(2)).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(title(2)).not.toBeInTheDocument()
  const filedGrid = row('Filed take').element().closest('[role="grid"]')!
  await expect.poll(() => filedGrid.contains(document.activeElement)).toBe(true)
})

it('toggles a row from its tune line while selecting, and stays on the list', async () => {
  const { tuneId } = await createTune(db, { title: 'Cluck Old Hen' }, { status: 'known' })
  await db.recordings.put(recordingRow('filed', { label: 'Filed take', tune_id: tuneId }))
  // Off the tune sort the filed rows are one list, and each row names its tune.
  await show()
  await expect.element(row('Filed take')).toBeVisible()
  await startSelecting()
  await expect
    .element(page.getByRole('button', { name: openTuneName('Cluck Old Hen') }))
    .not.toBeInTheDocument()
  await row('Filed take').getByText('Cluck Old Hen', { exact: true }).click()
  await expect.element(row('Filed take')).toHaveAttribute('aria-selected', 'true')
  await expect.element(title(1)).toBeVisible()
  await expect
    .element(page.getByRole('heading', { level: 1, name: 'Cluck Old Hen' }))
    .not.toBeInTheDocument()
})
