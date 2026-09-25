import userEvent from '@testing-library/user-event'
import { useEffect, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { RECORDING_NOT_FOUND } from '../../commands/messages'
import { addUploadedFile, updateRecording } from '../../commands/recordings'
import { setInstruments, settingsId } from '../../commands/settings'
import { createTune } from '../../commands/tunes'
import { setStorage } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { recordingRow } from '../../test/rows'
import { SEARCH_TUNES } from '../catalog/TuneSearch'
import { NEW_TUNE_TITLE } from '../tune/TuneFormSheet'
import { ADD_TO_TUNE_ERROR, ADD_TO_TUNE_TITLE, AddToTuneSheet } from './AddToTuneSheet'
import {
  RECORDING_NAME_LABEL,
  RECORDING_NAME_PLACEHOLDER,
  RENAME_RECORDING_TITLE,
  RenameRecordingSheet,
} from './RenameRecordingSheet'
import { Storage, STORAGE_USED } from './Storage'
import type { RecordingView } from './useRecordings'
import { EMPTY_FILE_ERROR, NOT_AUDIO_ERROR, UPLOAD_AUDIO, UploadButton } from './UploadButton'

vi.mock('../../commands/recordings', { spy: true })

let db: CrosstuneDb

beforeEach(async () => {
  db = openTestDb()
  await db.recordings.put(recordingRow('r1', { label: 'Jam recording' }))
})

function view(label: string | null = 'Jam recording'): RecordingView {
  return {
    recording: recordingRow('r1', { label }),
    file: undefined,
    tuneId: null,
    tuneTitle: null,
  }
}

/** Stands in for the screen that opens a sheet: it nulls the target when the sheet reports it. */
function Host({
  sheet,
  target,
  onClose,
  onReady,
}: {
  sheet: 'rename' | 'add'
  target: RecordingView
  onClose: () => void
  /** Hands the screen's own opener out, so a test can ask for another recording. */
  onReady?: (open: (next: RecordingView) => void) => void
}) {
  const [open, setOpen] = useState<RecordingView | null>(target)
  useEffect(() => {
    onReady?.(setOpen)
  }, [onReady])
  const close = () => {
    onClose()
    setOpen(null)
  }
  return sheet === 'rename' ? (
    <RenameRecordingSheet view={open} onClose={close} />
  ) : (
    <AddToTuneSheet view={open} onClose={close} />
  )
}

const nameField = () => page.getByRole('textbox', { name: RECORDING_NAME_LABEL })
const search = () => page.getByRole('searchbox', { name: SEARCH_TUNES })
const closed = () =>
  vi.waitFor(() => expect(document.querySelector('ion-modal:not(.overlay-hidden)')).toBeNull())

/** Take the create offer for a title nothing matches, then save the tune form it opens. */
async function createFrom(title: string) {
  await search().fill(title)
  await page.getByRole('button', { name: `Add "${title}"` }).click()
  // The form only opens once the picker's dismissal has finished, so wait for its title.
  await expect.element(page.getByText(NEW_TUNE_TITLE)).toBeVisible()
  await expect.element(page.getByRole('textbox', { name: 'Title' })).toHaveValue(title)
  await page.getByRole('button', { name: 'Add' }).click()
}

describe('RenameRecordingSheet', () => {
  it('opens on the recording it was given, with its stored name', async () => {
    renderIonic(<Host sheet="rename" target={view()} onClose={vi.fn()} />, { db })
    await expect.element(page.getByText(RENAME_RECORDING_TITLE)).toBeVisible()
    // The sheet's title names the one field, so the field carries no header of its own,
    // which leaves the placeholder as the only thing showing where to type.
    await expect.element(nameField()).toBeVisible()
    await vi.waitFor(() =>
      expect(
        document
          .querySelector('ion-modal:not(.overlay-hidden) ion-input input')
          ?.getAttribute('placeholder'),
      ).toBe(RECORDING_NAME_PLACEHOLDER),
    )
    expect(
      document.querySelector('ion-modal:not(.overlay-hidden)')!.querySelectorAll('h2'),
    ).toHaveLength(0)
    await expect.element(nameField()).toHaveValue('Jam recording')
  })

  it('saves a trimmed name and closes', async () => {
    const onClose = vi.fn()
    renderIonic(<Host sheet="rename" target={view()} onClose={onClose} />, { db })
    await nameField().fill('  Barn dance  ')
    await page.getByRole('button', { name: 'Save' }).click()
    await vi.waitFor(() =>
      expect(vi.mocked(updateRecording)).toHaveBeenCalledWith(db, 'r1', { label: 'Barn dance' }),
    )
    await vi.waitFor(async () => expect((await db.recordings.get('r1'))?.label).toBe('Barn dance'))
    await closed()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('stores nothing at all for a blank name', async () => {
    renderIonic(<Host sheet="rename" target={view()} onClose={vi.fn()} />, { db })
    await nameField().fill('   ')
    await page.getByRole('button', { name: 'Save' }).click()
    await vi.waitFor(() =>
      expect(vi.mocked(updateRecording)).toHaveBeenCalledWith(db, 'r1', { label: null }),
    )
    await vi.waitFor(async () => expect((await db.recordings.get('r1'))?.label).toBeNull())
  })

  it('reports one close for one dismissal', async () => {
    const onClose = vi.fn()
    renderIonic(<Host sheet="rename" target={view()} onClose={onClose} />, { db })
    await expect.element(nameField()).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await closed()
    expect(onClose).toHaveBeenCalledOnce()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('saves once for two submits in the same tick', async () => {
    renderIonic(<Host sheet="rename" target={view()} onClose={vi.fn()} />, { db })
    await nameField().fill('Barn dance')
    const save = page.getByRole('button', { name: 'Save' })
    await expect.element(save).toBeVisible()
    // The toolbar button's native element lives in a shadow root, so only a composed click leaves it.
    save.element().dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
    save.element().dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
    await closed()
    expect(vi.mocked(updateRecording)).toHaveBeenCalledOnce()
  })
})

describe('AddToTuneSheet', () => {
  it('files the recording under the tune picked from the search, then closes', async () => {
    const { tuneId } = await createTune(db, { title: 'Cluck Old Hen' }, { status: 'known' })
    const onClose = vi.fn()
    renderIonic(<Host sheet="add" target={view()} onClose={onClose} />, { db })
    await search().fill('cluck')
    await page.getByRole('button', { name: 'Add to Cluck Old Hen' }).click()
    await vi.waitFor(() =>
      expect(vi.mocked(updateRecording)).toHaveBeenCalledWith(db, 'r1', { tune_id: tuneId }),
    )
    await vi.waitFor(async () => expect((await db.recordings.get('r1'))?.tune_id).toBe(tuneId))
    await closed()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('opens under its own title with the shared tune search', async () => {
    renderIonic(<Host sheet="add" target={view()} onClose={vi.fn()} />, { db })
    await expect.element(page.getByText(ADD_TO_TUNE_TITLE)).toBeVisible()
    await expect.element(search()).toBeVisible()
  })

  it('files the recording under a tune created from the typed title', async () => {
    const onClose = vi.fn()
    renderIonic(<Host sheet="add" target={view()} onClose={onClose} />, { db })
    await createFrom('Sally Goodin')
    const tune = await vi.waitFor(async () => {
      const [found] = await db.tunes.where('title').equals('Sally Goodin').toArray()
      expect(found).toBeDefined()
      return found!
    })
    await vi.waitFor(() =>
      expect(vi.mocked(updateRecording)).toHaveBeenCalledWith(db, 'r1', { tune_id: tune.id }),
    )
    await vi.waitFor(async () => expect((await db.recordings.get('r1'))?.tune_id).toBe(tune.id))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('reports a backdrop dismissal once and opens again for another recording', async () => {
    const onClose = vi.fn()
    let reopen: (next: RecordingView) => void = () => {}
    renderIonic(
      <Host
        sheet="add"
        target={view()}
        onClose={onClose}
        onReady={(open) => {
          reopen = open
        }}
      />,
      { db },
    )
    await expect.element(search()).toBeVisible()
    const sheet = document.querySelector<HTMLIonModalElement>('ion-modal:not(.overlay-hidden)')!
    await sheet.dismiss(undefined, 'backdrop')
    await closed()
    expect(onClose).toHaveBeenCalledOnce()
    // Ionic ignores a present that lands while the previous dismissal is still settling, so the
    // next open waits for the close to reach the modal, not only for its hidden class.
    await vi.waitFor(() => expect(sheet.isOpen).toBe(false))
    reopen(view('Barn dance'))
    await expect.element(page.getByText(ADD_TO_TUNE_TITLE)).toBeVisible()
    await expect.element(search()).toBeVisible()
  })

  it('offers a Cancel big enough to tap that closes the sheet', async () => {
    const onClose = vi.fn()
    renderIonic(<Host sheet="add" target={view()} onClose={onClose} />, { db })
    const cancel = page.getByRole('button', { name: 'Cancel' })
    await expect.element(cancel).toBeVisible()
    expect(
      (cancel.element().getRootNode() as ShadowRoot).host.getBoundingClientRect().height,
    ).toBeGreaterThanOrEqual(44)
    await cancel.click()
    await closed()
    expect(onClose).toHaveBeenCalledOnce()
    expect(vi.mocked(updateRecording)).not.toHaveBeenCalled()
  })

  it('holds the tune form back until the instruments it shows tunings for are read', async () => {
    // The form fixes its tuning fields as it opens, so opening it against an unread settings row
    // would leave the whole edit with none.
    await setInstruments(db, 'user_1', ['violin'])
    const row = await db.user_settings.get(settingsId('user_1'))
    let read: (row: unknown) => void = () => {}
    vi.spyOn(db.user_settings, 'get').mockReturnValue(
      new Promise((resolve) => {
        read = resolve
      }) as never,
    )
    renderIonic(<Host sheet="add" target={view()} onClose={vi.fn()} />, { db })
    await search().fill('Sally Goodin')
    await page.getByRole('button', { name: 'Add "Sally Goodin"' }).click()
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(page.getByText(NEW_TUNE_TITLE).elements()).toHaveLength(0)
    read(row)
    await expect.element(page.getByText(NEW_TUNE_TITLE)).toBeVisible()
    // The Tuning group renders only once there is a tuning to show, so it is the proof.
    await expect.element(page.getByRole('heading', { name: 'Tuning' })).toBeVisible()
    await expect
      .element(page.getByRole('button', { name: 'Violin tuning, Not set', exact: true }))
      .toBeInTheDocument()
  })

  it('says so when the tune is made but the recording cannot be filed under it', async () => {
    let fail = (_error: Error) => {}
    vi.mocked(updateRecording).mockReturnValueOnce(
      new Promise<void>((_resolve, reject) => {
        fail = reject
      }),
    )
    renderIonic(<Host sheet="add" target={view()} onClose={vi.fn()} />, { db })
    await createFrom('Sally Goodin')
    await closed()
    // The tune is saved and both sheets are gone, so the only surface left is the app's toast.
    fail(new Error(RECORDING_NOT_FOUND))
    await expect.element(page.getByText(ADD_TO_TUNE_ERROR)).toBeVisible()
    expect(await db.tunes.where('title').equals('Sally Goodin').count()).toBe(1)
  })
})

describe('UploadButton', () => {
  const picker = () => page.getByLabelText(UPLOAD_AUDIO).element() as HTMLInputElement

  it('offers a real file picker behind a control big enough to tap', async () => {
    renderIonic(<UploadButton tuneId={null} />, { db })
    const control = page.getByRole('button', { name: 'Upload' })
    await expect.element(control).toBeVisible()
    const host = (control.element().getRootNode() as ShadowRoot).host
    expect(host.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    expect(picker()).toHaveAttribute('type', 'file')
    expect(picker()).toHaveAttribute('accept', 'audio/*')
  })

  it('refuses a file that is not audio', async () => {
    renderIonic(<UploadButton tuneId={null} />, { db })
    await expect.element(page.getByRole('button', { name: 'Upload' })).toBeVisible()
    // The accept attribute is only a picker hint; drag-drop and some pickers still deliver a
    // mismatched file, so the check is bypassed here.
    await userEvent
      .setup({ applyAccept: false })
      .upload(picker(), new File(['x'], 'notes.txt', { type: 'text/plain' }))
    await expect.element(page.getByRole('alert')).toHaveTextContent(NOT_AUDIO_ERROR)
    expect(vi.mocked(addUploadedFile)).not.toHaveBeenCalled()
  })

  it('refuses an empty file', async () => {
    renderIonic(<UploadButton tuneId={null} />, { db })
    await expect.element(page.getByRole('button', { name: 'Upload' })).toBeVisible()
    await userEvent.upload(picker(), new File([], 'empty.wav', { type: 'audio/wav' }))
    await expect.element(page.getByRole('alert')).toHaveTextContent(EMPTY_FILE_ERROR)
    expect(vi.mocked(addUploadedFile)).not.toHaveBeenCalled()
  })

  it('refuses a file over the cached size limit', async () => {
    await setStorage(db, { used_bytes: 0, quota_bytes: 1_000_000_000, max_file_bytes: 2 })
    renderIonic(<UploadButton tuneId={null} />, { db })
    await expect.element(page.getByRole('button', { name: 'Upload' })).toBeVisible()
    await userEvent.upload(picker(), new File(['abc'], 'big.wav', { type: 'audio/wav' }))
    await expect.element(page.getByRole('alert')).toHaveTextContent('Files are limited to 2 B.')
    expect(vi.mocked(addUploadedFile)).not.toHaveBeenCalled()
  })

  it('files a good audio file under the tune it was given', async () => {
    renderIonic(<UploadButton tuneId="s1" />, { db })
    await expect.element(page.getByRole('button', { name: 'Upload' })).toBeVisible()
    const file = new File(['abc'], 'jam.m4a', { type: 'audio/mp4' })
    await userEvent.upload(picker(), file)
    await vi.waitFor(() =>
      expect(vi.mocked(addUploadedFile)).toHaveBeenCalledWith(db, file, {
        tuneId: 's1',
        label: 'jam',
      }),
    )
    expect(page.getByRole('alert').elements()).toHaveLength(0)
  })

  it('hands a refusal to a caller that takes one instead of showing its own line', async () => {
    const onError = vi.fn()
    renderIonic(<UploadButton tuneId={null} onError={onError} />, { db })
    await expect.element(page.getByRole('button', { name: 'Upload' })).toBeVisible()
    await userEvent
      .setup({ applyAccept: false })
      .upload(picker(), new File(['x'], 'notes.txt', { type: 'text/plain' }))
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(NOT_AUDIO_ERROR))
    // The pick itself drops whatever the last one left behind, before it can fail again.
    expect(onError.mock.calls[0]).toEqual([null])
    expect(page.getByRole('alert').elements()).toHaveLength(0)
  })
})

describe('Storage', () => {
  it('reads out what is used against the quota', async () => {
    await setStorage(db, { used_bytes: 1_000_000, quota_bytes: 2_000_000, max_file_bytes: 500_000 })
    renderIonic(<Storage />, { db })
    await expect.element(page.getByText('1 MB of 2 MB used')).toBeVisible()
    await expect.element(page.getByRole('progressbar', { name: STORAGE_USED })).toBeVisible()
  })

  it('shows no meter until a quota is known', async () => {
    renderIonic(
      <>
        <Storage />
        <p>Recordings</p>
      </>,
      { db },
    )
    await expect.element(page.getByText('Recordings')).toBeVisible()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(page.getByRole('progressbar').elements()).toHaveLength(0)
    expect(page.getByText('used', { exact: false }).elements()).toHaveLength(0)
  })

  it('shows no meter when the quota is zero', async () => {
    await setStorage(db, { used_bytes: 0, quota_bytes: 0, max_file_bytes: 0 })
    renderIonic(
      <>
        <Storage />
        <p>Recordings</p>
      </>,
      { db },
    )
    await expect.element(page.getByText('Recordings')).toBeVisible()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(page.getByRole('progressbar').elements()).toHaveLength(0)
  })
})
