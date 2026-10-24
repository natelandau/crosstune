import { page } from 'vitest/browser'
import { afterEach, expect, it } from 'vitest'
import { TUNE_LIMITS } from '../../api/vocabulary'
import { useDb } from '../../db/DbProvider'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { renderWithProviders } from '../../test/render'
import { recordingAnalytics } from '../../usage/testing'
import { ToastProvider, UNDO, type ToastClock } from '../../ui/Toast'
import { AddTuneProvider } from './AddTuneProvider'
import { clearFresh } from './freshTune'
import { addedMessage, keptMessage } from './tuneScreenCopy'
import { useAddTune } from './useAddTune'
import { useTuneActions } from './useTuneActions'

afterEach(clearFresh)

// Padded and over the limit, so the stored title differs from what was typed at both ends.
const TYPED = `  ${'Soldier’s Joy '.repeat(20)}  `
const STORED = TYPED.trim().slice(0, TUNE_LIMITS.title).trim()

// A toast that never counts down, so it stays for the test's steps.
const STILL: ToastClock = { now: () => 0, setTimeout: () => 0, clearTimeout: () => {} }

function Harness() {
  const addTune = useAddTune()
  const actions = useTuneActions()
  const db = useDb()
  return (
    <>
      <button type="button" onClick={() => void addTune({ title: TYPED, source: 'catalog' })}>
        Add
      </button>
      <button
        type="button"
        onClick={() =>
          void db.tunes
            .toCollection()
            .first()
            .then((t) => actions.remove(t!.id))
        }
      >
        Delete
      </button>
    </>
  )
}

function setup() {
  const db = openTestDb()
  const analytics = recordingAnalytics()
  const Data = dataProviders({ db, analytics })
  renderWithProviders(
    <Data>
      <ToastProvider clock={STILL}>
        <AddTuneProvider>
          <Harness />
        </AddTuneProvider>
      </ToastProvider>
    </Data>,
  )
  return { db, analytics }
}

it('names the stored title in the Added toast', async () => {
  const { db } = setup()
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect.poll(() => db.tunes.count()).toBe(1)
  await expect.poll(async () => (await db.tunes.toArray())[0]?.title).toBe(STORED)
  await expect.element(page.getByRole('status').getByText(addedMessage(STORED))).toBeVisible()
})

it('names the stored title when Undo keeps a tune with work', async () => {
  const { db } = setup()
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect.element(page.getByRole('status').getByText(addedMessage(STORED))).toBeVisible()
  const userTune = (await db.user_tunes.toArray())[0]!
  await db.user_tunes.update(userTune.id, { notes: 'Watch the B part.' })
  await page.getByRole('status').getByRole('button', { name: UNDO }).click()
  await expect.element(page.getByRole('status').getByText(keptMessage(STORED))).toBeVisible()
})

it('Undo after the tune was deleted another way reports and shows no new toast', async () => {
  const { db, analytics } = setup()
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect.element(page.getByRole('status').getByText(addedMessage(STORED))).toBeVisible()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect.poll(async () => (await db.tunes.toArray())[0]?.deleted_at).toBeTruthy()
  await expect
    .poll(() => analytics.sends().filter((s) => s.name === 'tune_deleted'))
    .toHaveLength(1)
  const shown = document.querySelector('[role="status"]')?.textContent
  await page.getByRole('status').getByRole('button', { name: UNDO }).click()
  // A write transaction queues behind Undo's, so what Undo would do has been done by now.
  await db.transaction('rw', db.tables, () => {})
  await expect
    .poll(() => analytics.sends().filter((s) => s.name === 'tune_deleted'))
    .toHaveLength(1)
  await expect
    .element(page.getByRole('status').getByText(keptMessage(STORED)))
    .not.toBeInTheDocument()
  expect(document.querySelector('[role="status"]')?.textContent).toBe(shown)
})
