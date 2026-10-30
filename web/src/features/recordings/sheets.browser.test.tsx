import { useState } from 'react'
import { page, userEvent } from 'vitest/browser'
import { expect, it, vi } from 'vitest'
import { recordingAnalytics } from '../../usage/testing'
import { createTune } from '../../commands/tunes'
import { addTypedTitleLabel, SEARCH_TUNES } from '../catalog/catalogCopy'
import { recordingDateLabel } from '../../text/format'
import { RECORDING_LIMITS } from '../../api/vocabulary'
import type { LocalRecording } from '../../db/types'
import { EDIT, RECORDING_NAME_LABEL } from './recordingCopy'
import {
  ADD_TO_TUNE_TITLE,
  addToTuneName,
  EDIT_RECORDING_TITLE,
  filedToast,
  LOCATION_ACCESS_OFF,
  NOTES_LABEL,
  LOCATION_LABEL,
  locationRowName,
  pickLocationName,
  PLAYERS_LABEL,
  SAVE_RECORDING,
} from './recordingsCopy'
import type { RecordingView } from './useRecordings'
import { openTestDb } from '../../test/db'
import { fakeLocationPermissionForTest } from '../../test/fakeLocationPermission'
import { dataProviders } from '../../test/providers'
import { recordingRow, tuneRow, userTuneRow } from '../../test/rows'
import { CANCEL } from '../../ui/confirmCopy'
import { CLEAR_DATE, YEAR_LABEL } from '../../ui/partialDate'
import { renderWithProviders } from '../../test/render'
import { seen } from '../../test/events'
import { renderApp } from '../../test/renderApp'
import { TUNE } from '../tune/tunePageCopy'
import { UNDO } from '../../ui/Toast'
import { AddToTuneSheet } from './AddToTuneSheet'

const WIDE = { width: 1280, height: 800 }

const sheet = (name: string) => page.getByRole('dialog', { name })

async function editFromTunePage(others: LocalRecording[] = []) {
  const db = openTestDb()
  await db.tunes.put(tuneRow('t1', "Soldier's Joy"))
  await db.user_tunes.put(userTuneRow('u-t1', 't1'))
  await db.recordings.bulkPut([
    recordingRow('r1', { tune_id: 't1', label: 'Fast take' }),
    ...others,
  ])
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

it('edits notes, players, and place, offering the ones used before', async () => {
  const galax = { place_name: 'Galax, VA', place_lat: 36.66, place_lon: -80.92 }
  const { db, dialog } = await editFromTunePage([recordingRow('r2', { players: 'Ruth', ...galax })])
  const notes = dialog.getByRole('textbox', { name: NOTES_LABEL })
  await expect.element(notes).toHaveAttribute('maxlength', String(RECORDING_LIMITS.notes))
  expect(notes.element().tagName).toBe('TEXTAREA')
  await notes.fill('Capo 2')
  const players = dialog.getByRole('combobox', { name: PLAYERS_LABEL })
  await players.click()
  await page.getByRole('option', { name: 'Ruth' }).click()
  await expect.element(players).toHaveValue('Ruth')
  await dialog.getByRole('button', { name: locationRowName(null) }).click()
  await page
    .getByRole('dialog', { name: LOCATION_LABEL })
    .getByRole('button', { name: pickLocationName(galax.place_name), exact: true })
    .click()
  await expect
    .element(dialog.getByRole('button', { name: locationRowName(galax.place_name) }))
    .toBeVisible()
  await dialog.getByRole('button', { name: SAVE_RECORDING, exact: true }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.poll(async () => (await db.recordings.get('r1'))?.notes).toBe('Capo 2')
  const stored = (await db.recordings.get('r1'))!
  expect(stored).toMatchObject({ players: 'Ruth', ...galax, place_accuracy_m: null })
})

it('leaves the location access note to the location page', async () => {
  fakeLocationPermissionForTest('denied')
  const { dialog } = await editFromTunePage()
  await expect.element(dialog.getByRole('button', { name: locationRowName(null) })).toBeVisible()
  expect(dialog.getByText(LOCATION_ACCESS_OFF).query()).toBeNull()
  await dialog.getByRole('button', { name: locationRowName(null) }).click()
  await expect
    .element(page.getByRole('dialog', { name: LOCATION_LABEL }).getByText(LOCATION_ACCESS_OFF))
    .toBeVisible()
})

it('takes players typed straight into an empty field', async () => {
  const { db, dialog } = await editFromTunePage()
  const players = dialog.getByRole('combobox', { name: PLAYERS_LABEL })
  await expect.element(players).toHaveValue('')
  await players.click()
  await userEvent.keyboard('Ruth and Ed')
  await expect.element(players).toHaveValue('Ruth and Ed')
  await dialog.getByRole('button', { name: SAVE_RECORDING, exact: true }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.poll(async () => (await db.recordings.get('r1'))?.players).toBe('Ruth and Ed')
})

it('caps a typed player at the players limit', async () => {
  const { dialog } = await editFromTunePage()
  await expect
    .element(dialog.getByRole('combobox', { name: PLAYERS_LABEL }))
    .toHaveAttribute('maxlength', String(RECORDING_LIMITS.players))
})

function view(): RecordingView {
  return {
    recording: recordingRow('r1', { label: 'Jam recording' }),
    file: undefined,
    tuneId: null,
    tuneTitle: null,
    holdsSplitAudio: false,
  }
}

/** Fakes the screen that opens the sheet: it nulls the recording once the sheet closes. */
function Host({
  initial,
  onClose,
  onOpenTune,
}: {
  initial: RecordingView
  onClose: () => void
  onOpenTune: (tuneId: string) => void
}) {
  const [shown, setShown] = useState<RecordingView | null>(initial)
  return (
    <AddToTuneSheet
      source="recordings_list"
      view={shown}
      onOpenTune={onOpenTune}
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
  const onClose = vi.fn()
  const onOpenTune = vi.fn<(tuneId: string) => void>()
  const analytics = recordingAnalytics()
  const Data = dataProviders({ db, analytics })
  renderWithProviders(
    <Data>
      <Host initial={view()} onClose={onClose} onOpenTune={onOpenTune} />
    </Data>,
  )
  const dialog = sheet(ADD_TO_TUNE_TITLE)
  await expect.element(dialog).toBeVisible()
  return { db, dialog, onClose, onOpenTune, analytics }
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

it('files a recording under a new tune made from the typed title, and opens it', async () => {
  const { db, dialog, onClose, onOpenTune, analytics } = await mountAdd()
  await dialog.getByRole('searchbox', { name: SEARCH_TUNES }).fill('Sally Goodin')
  await dialog
    .getByRole('button', {
      name: addTypedTitleLabel({ kind: 'create', title: 'Sally Goodin', another: false }),
    })
    .click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.poll(() => onClose).toHaveBeenCalledOnce()
  await expect.poll(() => db.tunes.where('title').equals('Sally Goodin').count()).toBe(1)
  const [tune] = await db.tunes.where('title').equals('Sally Goodin').toArray()
  await expect.poll(async () => (await db.recordings.get('r1'))?.tune_id).toBe(tune!.id)
  await expect.poll(() => onOpenTune).toHaveBeenCalledExactlyOnceWith(tune!.id)
  expect(page.getByRole('dialog').elements()).toHaveLength(0)
  await expect
    .poll(() => analytics.sends())
    .toEqual([
      {
        name: 'tune_created',
        props: { source: 'recordings_list', fields_set: ['title'], tune_id: tune!.id },
      },
      {
        name: 'recording_filed',
        props: { from: 'unfiled', origin: 'recorded', recording_id: 'r1', tune_id: tune!.id },
      },
    ])
})
