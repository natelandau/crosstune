import userEvent from '@testing-library/user-event'
import { useEffect, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { RECORDED_DATE_FUTURE, RECORDING_NOT_FOUND } from '../../commands/messages'
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
import { RECORDING_NAME_LABEL, recordedAtNote } from './recordingCopy'
import {
  ANY_LABEL,
  CLEAR_DATE,
  DATE_RECORDED_LABEL,
  DAY_LABEL,
  EDIT_RECORDING_TITLE,
  EditRecordingSheet,
  MONTH_LABEL,
  NAME_LABEL,
  RECORDING_NAME_PLACEHOLDER,
  YEAR_LABEL,
} from './EditRecordingSheet'
import { openPickerRow } from '../../test/dialogs'
import { YEAR_FORMAT } from './recordedDateParts'
import type { LocalRecording } from '../../db/types'
import { recordedTime } from '../recording/format'
import { Storage, STORAGE_USED } from './Storage'
import type { RecordingView } from './useRecordings'
import { EMPTY_FILE_ERROR, NOT_AUDIO_ERROR, refusedFile } from './addAudioFiles'
import { UPLOAD_AUDIO, UploadButton } from './UploadButton'
import { CANCEL } from '../../ui/Confirm'
import { measureDuration } from '../recording/measureDuration'

vi.mock('../../commands/recordings', { spy: true })
vi.mock('../recording/measureDuration', { spy: true })

let db: CrosstuneDb

beforeEach(async () => {
  db = openTestDb()
  await db.recordings.put(recordingRow('r1', { label: 'Jam recording' }))
})

function view(
  label: string | null = 'Jam recording',
  extra: Partial<LocalRecording> = {},
): RecordingView {
  return {
    recording: recordingRow('r1', { label, ...extra }),
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
  sheet: 'edit' | 'add'
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
  return sheet === 'edit' ? (
    <EditRecordingSheet view={open} onClose={close} />
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

describe('EditRecordingSheet', () => {
  it('opens on the recording it was given, with its stored name', async () => {
    renderIonic(<Host sheet="edit" target={view()} onClose={vi.fn()} />, { db })
    await expect.element(page.getByText(EDIT_RECORDING_TITLE)).toBeVisible()
    await expect.element(nameField()).toBeVisible()
    await vi.waitFor(() =>
      expect(
        document
          .querySelector('ion-modal:not(.overlay-hidden) ion-input input')
          ?.getAttribute('placeholder'),
      ).toBe(RECORDING_NAME_PLACEHOLDER),
    )
    await expect.element(nameField()).toHaveValue('Jam recording')
  })

  it('saves a trimmed name and closes', async () => {
    const onClose = vi.fn()
    renderIonic(<Host sheet="edit" target={view()} onClose={onClose} />, { db })
    await nameField().fill('  Barn dance  ')
    await page.getByRole('button', { name: 'Save' }).click()
    await vi.waitFor(() =>
      expect(vi.mocked(updateRecording)).toHaveBeenCalledWith(db, 'r1', { label: 'Barn dance' }),
    )
    await vi.waitFor(async () => expect((await db.recordings.get('r1'))?.label).toBe('Barn dance'))
    await closed()
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('stores nothing at all for a blank name', async () => {
    renderIonic(<Host sheet="edit" target={view()} onClose={vi.fn()} />, { db })
    await nameField().fill('   ')
    await page.getByRole('button', { name: 'Save' }).click()
    await vi.waitFor(() =>
      expect(vi.mocked(updateRecording)).toHaveBeenCalledWith(db, 'r1', { label: null }),
    )
    await vi.waitFor(async () => expect((await db.recordings.get('r1'))?.label).toBeNull())
  })

  it('reports one close for one dismissal', async () => {
    const onClose = vi.fn()
    renderIonic(<Host sheet="edit" target={view()} onClose={onClose} />, { db })
    await expect.element(nameField()).toBeVisible()
    await page.getByRole('button', { name: CANCEL }).click()
    await closed()
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('saves once for two submits in the same tick', async () => {
    renderIonic(<Host sheet="edit" target={view()} onClose={vi.fn()} />, { db })
    await nameField().fill('Barn dance')
    const save = page.getByRole('button', { name: 'Save' })
    await expect.element(save).toBeVisible()
    // The toolbar button's native element lives in a shadow root, so only a composed click leaves it.
    save.element().dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
    save.element().dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
    await closed()
    await vi.waitFor(() => expect(vi.mocked(updateRecording)).toHaveBeenCalledOnce())
  })
})

describe('EditRecordingSheet date recorded', () => {
  // A take on Oct 3 2026 at 16:12 UTC, a day before the pinned clock.
  const TAKE = '2026-10-03T16:12:00.000Z'

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-04T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const year = () => page.getByRole('textbox', { name: YEAR_LABEL })
  const select = (label: string, value: string) =>
    page.getByRole('button', { name: `${label}, ${value}`, exact: true })
  const options = () =>
    page
      .getByRole('radio')
      .elements()
      .map((option) => option.textContent?.trim())

  async function pick(label: string, current: string, option: string) {
    await openPickerRow(`${label}, ${current}`, { exact: true })
    await page.getByRole('radio', { name: option, exact: true }).click()
    await expect.element(select(label, option)).toBeInTheDocument()
  }

  async function open(extra: Partial<LocalRecording>) {
    await db.recordings.put(recordingRow('r1', { label: 'Jam recording', ...extra }))
    renderIonic(<Host sheet="edit" target={view('Jam recording', extra)} onClose={vi.fn()} />, {
      db,
    })
    await expect.element(nameField()).toBeVisible()
  }

  const save = () => page.getByRole('button', { name: 'Save' }).click()
  const stored = () => db.recordings.get('r1')

  it('heads the name and the date recorded', async () => {
    await open({ recorded_at: null, recorded_precision: null })
    await expect.element(page.getByRole('heading', { name: NAME_LABEL })).toBeVisible()
    await expect.element(page.getByRole('heading', { name: DATE_RECORDED_LABEL })).toBeVisible()
  })

  it('keeps a take exact when only the name changes', async () => {
    await open({ recorded_at: TAKE, recorded_precision: 'time' })
    await expect.element(page.getByText(recordedAtNote(recordedTime(TAKE)))).toBeVisible()
    await nameField().fill('Barn dance')
    await save()
    await vi.waitFor(() =>
      expect(vi.mocked(updateRecording)).toHaveBeenCalledWith(db, 'r1', { label: 'Barn dance' }),
    )
    await expect.poll(async () => (await stored())?.recorded_at).toBe(TAKE)
    expect((await stored())?.recorded_precision).toBe('time')
  })

  it('saves a year alone as the start of that year', async () => {
    await open({ recorded_at: null, recorded_precision: null })
    await year().fill('1937')
    await save()
    await expect.poll(async () => (await stored())?.recorded_precision).toBe('year')
    expect((await stored())?.recorded_at).toBe('1937-01-01T00:00:00.000Z')
  })

  it('saves a year, month, and day as that day', async () => {
    await open({ recorded_at: null, recorded_precision: null })
    await year().fill('1998')
    await pick(MONTH_LABEL, ANY_LABEL, 'October')
    await pick(DAY_LABEL, ANY_LABEL, '3')
    await save()
    await expect.poll(async () => (await stored())?.recorded_precision).toBe('day')
    expect((await stored())?.recorded_at).toBe('1998-10-03T00:00:00.000Z')
  })

  it('opens an import’s year filled in', async () => {
    await open({ recorded_at: '1937-01-01T00:00:00.000Z', recorded_precision: 'year' })
    await expect.element(year()).toHaveValue('1937')
    await expect.element(select(MONTH_LABEL, ANY_LABEL)).toBeInTheDocument()
  })

  it('enables Month once a year is set, and Day once a month is', async () => {
    await open({ recorded_at: null, recorded_precision: null })
    await expect.element(select(MONTH_LABEL, ANY_LABEL)).toBeDisabled()
    await expect.element(select(DAY_LABEL, ANY_LABEL)).toBeDisabled()
    await year().fill('1998')
    await expect.element(select(MONTH_LABEL, ANY_LABEL)).toBeEnabled()
    await expect.element(select(DAY_LABEL, ANY_LABEL)).toBeDisabled()
    await pick(MONTH_LABEL, ANY_LABEL, 'May')
    await expect.element(select(DAY_LABEL, ANY_LABEL)).toBeEnabled()
  })

  it('ends the days at the month’s last, Feb 29 in a leap year', async () => {
    await open({ recorded_at: null, recorded_precision: null })
    await year().fill('2024')
    await pick(MONTH_LABEL, ANY_LABEL, 'February')
    await openPickerRow(`${DAY_LABEL}, ${ANY_LABEL}`, { exact: true })
    await expect.poll(() => options().at(-1)).toBe('29')
    expect(options()).toHaveLength(30)
    await page.getByRole('radio', { name: '29', exact: true }).click()
    await save()
    await expect.poll(async () => (await stored())?.recorded_at).toBe('2024-02-29T00:00:00.000Z')
  })

  it('ends a common year’s February at the 28th', async () => {
    await open({ recorded_at: null, recorded_precision: null })
    await year().fill('2023')
    await pick(MONTH_LABEL, ANY_LABEL, 'February')
    await openPickerRow(`${DAY_LABEL}, ${ANY_LABEL}`, { exact: true })
    await expect.poll(() => options().at(-1)).toBe('28')
  })

  it('refuses a year after this one under the field', async () => {
    await open({ recorded_at: null, recorded_precision: null })
    await year().fill('2027')
    await save()
    await expect.element(page.getByRole('alert')).toHaveTextContent(RECORDED_DATE_FUTURE)
    await expect.element(year()).toHaveAttribute('aria-invalid', 'true')
    await expect.element(year()).toHaveFocus()
    expect(vi.mocked(updateRecording)).not.toHaveBeenCalled()
    await year().fill('2026')
    await expect.poll(() => page.getByRole('alert').elements()).toHaveLength(0)
  })

  it('refuses a year that is not four digits once a month is set', async () => {
    await open({ recorded_at: '1998-05-01T00:00:00.000Z', recorded_precision: 'month' })
    await expect.element(select(MONTH_LABEL, 'May')).toBeInTheDocument()
    await year().fill('98')
    await save()
    await expect.element(page.getByRole('alert')).toHaveTextContent(YEAR_FORMAT)
    expect(vi.mocked(updateRecording)).not.toHaveBeenCalled()
  })

  it('saves a blanked year as no date, even with a month left behind it', async () => {
    await open({ recorded_at: '1998-05-01T00:00:00.000Z', recorded_precision: 'month' })
    await expect.element(select(MONTH_LABEL, 'May')).toBeInTheDocument()
    await year().fill('')
    await save()
    await expect.poll(async () => (await stored())?.recorded_precision).toBeNull()
    expect((await stored())?.recorded_at).toBeNull()
  })

  it('keeps a chosen day showing while the year is being retyped', async () => {
    await open({ recorded_at: '1998-10-03T00:00:00.000Z', recorded_precision: 'day' })
    await expect.element(select(DAY_LABEL, '3')).toBeEnabled()
    await year().fill('19')
    await expect.element(select(DAY_LABEL, '3')).toBeDisabled()
    await year().fill('1999')
    await expect.element(select(DAY_LABEL, '3')).toBeEnabled()
  })

  it('clears the date to unknown', async () => {
    await open({ recorded_at: TAKE, recorded_precision: 'time' })
    await page.getByRole('button', { name: CLEAR_DATE }).click()
    await expect.element(year()).toHaveValue('')
    await save()
    await expect.poll(async () => (await stored())?.recorded_precision).toBeNull()
    expect((await stored())?.recorded_at).toBeNull()
  })

  it('drops a take’s time once its date changes', async () => {
    await open({ recorded_at: TAKE, recorded_precision: 'time' })
    const local = new Date(TAKE)
    await year().fill('2025')
    await expect.element(page.getByText(recordedAtNote(recordedTime(TAKE)))).not.toBeInTheDocument()
    await save()
    await expect.poll(async () => (await stored())?.recorded_precision).toBe('day')
    expect((await stored())?.recorded_at).toBe(
      new Date(Date.UTC(2025, local.getMonth(), local.getDate())).toISOString(),
    )
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
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce())
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
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce())
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
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce())
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
    const cancel = page.getByRole('button', { name: CANCEL })
    await expect.element(cancel).toBeVisible()
    await expect
      .poll(
        () => (cancel.element().getRootNode() as ShadowRoot).host.getBoundingClientRect().height,
      )
      .toBeGreaterThanOrEqual(44)
    await cancel.click()
    await closed()
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce())
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
    await expect.poll(() => db.tunes.where('title').equals('Sally Goodin').count()).toBe(1)
  })
})

describe('UploadButton', () => {
  const picker = () => page.getByLabelText(UPLOAD_AUDIO).element() as HTMLInputElement

  it('offers a real file picker behind a control big enough to tap', async () => {
    renderIonic(<UploadButton tuneId={null} />, { db })
    const control = page.getByRole('button', { name: 'Upload' })
    await expect.element(control).toBeVisible()
    const host = (control.element().getRootNode() as ShadowRoot).host
    await expect.poll(() => host.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
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
        durationMs: null,
      }),
    )
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
  })

  it('stores the length it measured from the file', async () => {
    vi.mocked(measureDuration).mockResolvedValueOnce(42_000)
    renderIonic(<UploadButton tuneId={null} />, { db })
    await expect.element(page.getByRole('button', { name: 'Upload' })).toBeVisible()
    const file = new File(['abc'], 'reel.m4a', { type: 'audio/mp4' })
    await userEvent.upload(picker(), file)
    await vi.waitFor(() =>
      expect(vi.mocked(addUploadedFile)).toHaveBeenCalledWith(db, file, {
        tuneId: null,
        label: 'reel',
        durationMs: 42_000,
      }),
    )
    expect(vi.mocked(measureDuration)).toHaveBeenCalledWith(file)
  })

  it('adds every file picked at once, naming the one it refused', async () => {
    renderIonic(<UploadButton tuneId={null} />, { db })
    await expect.element(page.getByRole('button', { name: 'Upload' })).toBeVisible()
    expect(picker()).toHaveAttribute('multiple')
    const jam = new File(['abc'], 'jam.m4a', { type: 'audio/mp4' })
    const reel = new File(['abc'], 'reel.wav', { type: 'audio/wav' })
    await userEvent
      .setup({ applyAccept: false })
      .upload(picker(), [new File([], 'empty.wav', { type: 'audio/wav' }), jam, reel])
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(refusedFile('empty.wav', EMPTY_FILE_ERROR))
    expect(vi.mocked(addUploadedFile).mock.calls.map(([, file]) => file)).toEqual([jam, reel])
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
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
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
