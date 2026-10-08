import { useState } from 'react'
import { page, userEvent } from 'vitest/browser'
import { expect, it, vi } from 'vitest'
import { createTune } from '../../commands/tunes'
import { addOfferLabel, SEARCH_TUNES } from '../catalog/catalogCopy'
import { recordingDateLabel } from '../../text/format'
import { EDIT, RECORDING_NAME_LABEL } from './recordingCopy'
import {
  ADD_TO_TUNE_TITLE,
  addToTuneName,
  EDIT_RECORDING_TITLE,
  filedToast,
  SAVE_RECORDING,
} from './recordingsCopy'
import type { RecordingView } from './useRecordings'
import { ADD_NEW_TUNE, NEW_TUNE_TITLE, TITLE_FIELD } from '../tune/tuneFormCopy'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { recordingRow, tuneRow, userTuneRow } from '../../test/rows'
import { CANCEL } from '../../ui/confirmCopy'
import { CLEAR_DATE, YEAR_LABEL } from '../../ui/partialDate'
import { renderWithProviders } from '../../test/render'
import { seen } from '../../test/events'
import { renderApp } from '../../test/renderApp'
import { TuneFormProvider } from '../tune/TuneFormProvider'
import { TUNE } from '../tune/tunePageCopy'
import { UNDO } from '../../ui/Toast'
import { AddToTuneSheet } from './AddToTuneSheet'

const WIDE = { width: 1280, height: 800 }

const sheet = (name: string) => page.getByRole('dialog', { name })

async function editFromTunePage() {
  const db = openTestDb()
  await db.tunes.put(tuneRow('t1', "Soldier's Joy"))
  await db.user_tunes.put(userTuneRow('u-t1', 't1'))
  await db.recordings.put(recordingRow('r1', { tune_id: 't1', label: 'Fast take' }))
  await renderApp({ path: '/catalog/t1', db, frame: WIDE })
  const row = page.getByRole('main', { name: TUNE }).getByRole('row', { name: /Fast take/ })
  await row.hover()
  await row.getByRole('button', { name: EDIT, exact: true }).click()
  const dialog = sheet(EDIT_RECORDING_TITLE)
  await expect
    .element(dialog.getByRole('textbox', { name: RECORDING_NAME_LABEL }))
    .toHaveValue('Fast take')
  return { db, dialog }
}

it('renames a recording and sets its date, and its row shows both', async () => {
  const { db, dialog } = await editFromTunePage()
  await dialog.getByRole('textbox', { name: RECORDING_NAME_LABEL }).fill('Slow take')
  await dialog.getByRole('button', { name: CLEAR_DATE }).click()
  await dialog.getByRole('textbox', { name: YEAR_LABEL }).fill('2019')
  await dialog.getByRole('button', { name: SAVE_RECORDING, exact: true }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.poll(async () => (await db.recordings.get('r1'))?.recorded_precision).toBe('year')
  const stored = (await db.recordings.get('r1'))!
  expect(stored.label).toBe('Slow take')
  await expect
    .element(page.getByRole('main', { name: TUNE }).getByRole('row', { name: /Slow take/ }))
    .toHaveAccessibleName(new RegExp(recordingDateLabel(stored)))
})

it('keeps a changed edit through Escape, and Cancel discards it', async () => {
  const { db, dialog } = await editFromTunePage()
  const name = dialog.getByRole('textbox', { name: RECORDING_NAME_LABEL })
  await name.fill('Slow take')
  const escapes = seen('keyup', (event) => (event as KeyboardEvent).key === 'Escape')
  await userEvent.keyboard('{Escape}')
  await expect.poll(escapes).toBe(1)
  await expect
    .element(dialog.getByRole('button', { name: SAVE_RECORDING, exact: true }))
    .toBeEnabled()
  await expect.element(name).toHaveValue('Slow take')
  await dialog.getByRole('button', { name: CANCEL, exact: true }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  expect((await db.recordings.get('r1'))?.label).toBe('Fast take')
})

function view(): RecordingView {
  return {
    recording: recordingRow('r1', { label: 'Jam recording' }),
    file: undefined,
    tuneId: null,
    tuneTitle: null,
  }
}

/** Stands in for the screen that opens the sheet: it nulls the recording once the sheet closes. */
function Host({ initial, onClose }: { initial: RecordingView; onClose: () => void }) {
  const [shown, setShown] = useState<RecordingView | null>(initial)
  return (
    <AddToTuneSheet
      view={shown}
      onClose={() => {
        setShown(null)
        onClose()
      }}
    />
  )
}

async function mountAdd() {
  const db = openTestDb()
  await db.recordings.put(recordingRow('r1', { label: 'Jam recording' }))
  const navigated: string[] = []
  const onClose = vi.fn()
  const Data = dataProviders({ db })
  renderWithProviders(
    <Data>
      <TuneFormProvider navigate={(to) => navigated.push(to)}>
        <Host initial={view()} onClose={onClose} />
      </TuneFormProvider>
    </Data>,
  )
  const dialog = sheet(ADD_TO_TUNE_TITLE)
  await expect.element(dialog).toBeVisible()
  return { db, dialog, onClose, navigated }
}

it('files a recording under the tune picked, with an Undo', async () => {
  const { db, dialog, onClose } = await mountAdd()
  const { tuneId } = await createTune(db, { title: 'Cluck Old Hen' }, { status: 'known' })
  await dialog.getByRole('searchbox', { name: SEARCH_TUNES }).fill('cluck')
  await dialog.getByRole('row', { name: addToTuneName('Cluck Old Hen'), exact: true }).click()
  await expect.poll(async () => (await db.recordings.get('r1'))?.tune_id).toBe(tuneId)
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.poll(() => onClose).toHaveBeenCalledOnce()
  await expect.element(page.getByText(filedToast('Cluck Old Hen'))).toBeVisible()
  await page.getByRole('button', { name: UNDO }).click()
  await expect.poll(async () => (await db.recordings.get('r1'))?.tune_id).toBeNull()
})

it('files a recording under a new tune made from the typed title', async () => {
  const { db, dialog, onClose, navigated } = await mountAdd()
  await dialog.getByRole('searchbox', { name: SEARCH_TUNES }).fill('Sally Goodin')
  await dialog
    .getByRole('button', {
      name: addOfferLabel({ kind: 'create', title: 'Sally Goodin', another: false }),
    })
    .click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.poll(() => onClose).toHaveBeenCalledOnce()
  const form = sheet(NEW_TUNE_TITLE)
  await expect.element(form.getByRole('textbox', { name: TITLE_FIELD })).toHaveValue('Sally Goodin')
  await form.getByRole('button', { name: ADD_NEW_TUNE, exact: true }).click()
  await expect.element(form).not.toBeInTheDocument()
  const [tune] = await db.tunes.where('title').equals('Sally Goodin').toArray()
  expect(tune).toBeDefined()
  await expect.poll(async () => (await db.recordings.get('r1'))?.tune_id).toBe(tune!.id)
  expect(navigated).toEqual([])
})
