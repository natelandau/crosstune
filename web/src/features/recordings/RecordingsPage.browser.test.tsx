import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { deleteRecording, retryUpload, updateRecording } from '../../commands/recordings'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { MOUSE_QUERY } from '../../platform/pointer'
import type { SyncEngine } from '../../sync/types'
import { openTestDb } from '../../test/db'
import { renderScreen } from '../../test/ionic'
import { fakeEngine } from '../../test/providers'
import { recordingFile, recordingRow, tuneRow } from '../../test/rows'
import { SEARCH_TUNES } from '../catalog/TuneSearch'
import type { Player } from '../player/usePlayer'
import { ADD_TO_TUNE_TITLE } from './AddToTuneSheet'
import { DELETE_SYNCED_NOTE, DELETE_UNSYNCED_NOTE } from './recordingRow'
import { NO_RECORDINGS_HINT, NO_RECORDINGS_TITLE, RecordingsPage } from './RecordingsPage'
import { RECORDING_NAME_LABEL, RENAME_RECORDING_TITLE } from './RenameRecordingSheet'
import { NOT_AUDIO_ERROR, UPLOAD_AUDIO } from './UploadButton'
import { DELETE_RECORDING_TITLE } from './useRecordingActions'
import { useRecordingsWithFiles } from './useRecordings'

vi.mock('../../commands/recordings', { spy: true })
vi.mock('./useRecordings', { spy: true })

let db: CrosstuneDb
const originalMatchMedia = window.matchMedia

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  window.matchMedia = originalMatchMedia
  await db.delete()
})

function forceTouch() {
  window.matchMedia = (query: string) =>
    query === MOUSE_QUERY
      ? ({
          matches: false,
          media: query,
          addEventListener() {},
          removeEventListener() {},
        } as unknown as MediaQueryList)
      : originalMatchMedia.call(window, query)
}

function fakePlayer(overrides: Partial<Player> = {}): Player {
  return { item: null, play: vi.fn(), close: vi.fn(), returnFocus: vi.fn(), ...overrides }
}

function show(
  opts: { engine?: SyncEngine; player?: Player; probes?: Record<string, string> } = {},
) {
  return renderScreen(<RecordingsPage />, {
    db,
    engine: opts.engine,
    player: opts.player,
    probes: opts.probes,
    path: '/recordings',
    route: '/recordings',
  })
}

/** Each group's own name, in the order the screen lays the groups out. */
const groupNames = () =>
  page
    .getByRole('list')
    .elements()
    .map((list) => list.getAttribute('aria-label'))

/** A tune with a key and a user row, so its shared row has something to show. */
const addTune = (title: string, key = 'A') =>
  createTune(db, { title, key }, { status: 'known' }).then(({ tuneId }) => tuneId)

describe('RecordingsPage', () => {
  it('names the empty state and what to do about it', async () => {
    show()
    await expect.element(page.getByText(NO_RECORDINGS_TITLE)).toBeVisible()
    await expect.element(page.getByText(NO_RECORDINGS_HINT)).toBeVisible()
  })

  it('groups recordings under their tune, unfiled first', async () => {
    const tuneId = await addTune("Soldier's Joy")
    await db.recordings.put(
      recordingRow('r1', {
        tune_id: tuneId,
        label: 'Filed take',
        recorded_at: '2026-02-02T12:00:00.000Z',
      }),
    )
    await db.recordings.put(
      recordingRow('r2', { label: 'Jam recording', recorded_at: '2026-01-01T12:00:00.000Z' }),
    )
    show()
    await expect.element(page.getByRole('heading', { name: 'Jam recording' })).toBeVisible()
    expect(groupNames()).toEqual(['Unfiled', "Soldier's Joy"])
  })

  it("heads a tune's group with its name alone, above its recordings", async () => {
    const tuneId = await addTune("Soldier's Joy")
    await db.recordings.put(recordingRow('r1', { tune_id: tuneId, label: 'Filed take' }))
    show()
    const heading = page.getByRole('heading', { name: "Soldier's Joy", level: 2 })
    await expect.element(heading).toBeVisible()
    // The name and nothing else: the key, the status, and the tunings stay on the catalog's row.
    expect(heading.element().textContent).toBe("Soldier's Joy")
    expect(document.querySelectorAll('[data-tune-meta]')).toHaveLength(0)
    // The heading sits above the group rather than inside it, and its recordings a level under.
    await expect.element(page.getByRole('heading', { name: 'Filed take', level: 3 })).toBeVisible()
    const group = page.getByRole('list', { name: "Soldier's Joy" }).element()
    expect(Array.from(group.querySelectorAll('h2, h3')).map((h) => h.tagName)).toEqual(['H3'])
    expect(
      heading.element().compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('lays its groups out as cards on the grouped surface', async () => {
    await db.recordings.put(recordingRow('r1', { label: 'Jam recording' }))
    show()
    await expect.element(page.getByRole('heading', { name: 'Jam recording' })).toBeVisible()
    const item = document.querySelector('ion-item')!
    expect(document.querySelector('ion-content')!.classList.contains('grouped')).toBe(true)
    await vi.waitFor(() => {
      expect(item.closest('ion-list')!.classList.contains('list-inset')).toBe(true)
    })
  })

  it('titles an unlabeled recording by its date rather than repeating its heading', async () => {
    const tuneId = await addTune("Soldier's Joy")
    await db.recordings.put(
      recordingRow('r1', {
        tune_id: tuneId,
        label: null,
        recorded_at: '2026-03-14T20:05:00.000Z',
      }),
    )
    show()
    const group = page.getByRole('list', { name: "Soldier's Joy" })
    await expect.element(group).toBeVisible()
    // The browser project runs in the machine's own zone, so the date itself is not asserted.
    const row = page.getByRole('heading', { name: 'Recording, ', exact: false, level: 3 })
    await expect.element(row).toBeVisible()
    const title = row.element().textContent!
    // The tune's name belongs to the heading above the group, never to a row inside it.
    expect(group.element().textContent).not.toContain("Soldier's Joy")
    expect(title).not.toContain("Soldier's Joy")
    // The row's actions are named from the same title.
    await expect.element(page.getByRole('button', { name: `Rename ${title}` })).toBeInTheDocument()
  })

  it('files a recording as unfiled once its tune is deleted elsewhere', async () => {
    await db.tunes.put(tuneRow('s1', "Soldier's Joy", { deleted_at: '2026-02-01T00:00:00.000Z' }))
    await db.recordings.put(recordingRow('r1', { tune_id: 's1', label: 'Jam recording' }))
    show()
    await expect.element(page.getByRole('heading', { name: 'Jam recording' })).toBeVisible()
    expect(groupNames()).toEqual(['Unfiled'])
    expect(page.getByRole('button', { name: "Soldier's Joy" }).elements()).toHaveLength(0)
  })

  it('opens the rename sheet on the recording a row names', async () => {
    await db.recordings.put(recordingRow('r1', { label: 'Jam recording' }))
    show()
    await page.getByRole('button', { name: 'Rename Jam recording' }).click()
    await expect.element(page.getByText(RENAME_RECORDING_TITLE)).toBeVisible()
    await expect
      .element(page.getByRole('textbox', { name: RECORDING_NAME_LABEL }))
      .toHaveValue('Jam recording')
  })

  it('offers an unfiled recording the tune picker, and not the reverse', async () => {
    await db.recordings.put(recordingRow('r1', { label: 'Jam recording' }))
    show()
    await expect.element(page.getByRole('heading', { name: 'Jam recording' })).toBeVisible()
    expect(page.getByRole('button', { name: 'Remove from tune Jam recording' }).elements()).toEqual(
      [],
    )
    await page.getByRole('button', { name: 'Add to tune Jam recording' }).click()
    await expect.element(page.getByText(ADD_TO_TUNE_TITLE)).toBeVisible()
    await expect.element(page.getByRole('searchbox', { name: SEARCH_TUNES })).toBeVisible()
  })

  it('unfiles a filed recording from its own row', async () => {
    const tuneId = await addTune("Soldier's Joy")
    await db.recordings.put(recordingRow('r1', { tune_id: tuneId, label: 'Filed take' }))
    show()
    await expect.element(page.getByRole('heading', { name: 'Filed take' })).toBeVisible()
    expect(page.getByRole('button', { name: 'Add to tune Filed take' }).elements()).toEqual([])
    await page.getByRole('button', { name: 'Remove from tune Filed take' }).click()
    await vi.waitFor(async () => expect((await db.recordings.get('r1'))?.tune_id).toBeNull())
    await vi.waitFor(() => expect(groupNames()).toEqual(['Unfiled']))
  })

  it('reports a refused row action on one line under the groups', async () => {
    const tuneId = await addTune("Soldier's Joy")
    await db.recordings.put(recordingRow('r1', { tune_id: tuneId, label: 'Filed take' }))
    show()
    await expect.element(page.getByRole('heading', { name: 'Filed take' })).toBeVisible()
    vi.mocked(updateRecording).mockRejectedValueOnce(new Error('The tune would not let go.'))
    await page.getByRole('button', { name: 'Remove from tune Filed take' }).click()
    const line = page.getByRole('alert')
    await expect.element(line).toHaveTextContent('The tune would not let go.')
    // Under the groups, not inside the row that failed.
    expect(line.element().closest('ion-item')).toBeNull()
  })

  it('warns that a recording held only here cannot be recovered, and asks first', async () => {
    await db.recordings.put(recordingRow('r1', { label: 'Jam recording', state: 'pending_upload' }))
    await db.recording_files.put(recordingFile('r1', { local_state: 'captured' }))
    show()
    await page.getByRole('button', { name: 'Delete Jam recording' }).click()
    await expect.element(page.getByText(DELETE_RECORDING_TITLE)).toBeVisible()
    await expect.element(page.getByText(DELETE_UNSYNCED_NOTE)).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await vi.waitFor(() => expect(document.querySelector('ion-alert')).toBeNull())
    expect((await db.recordings.get('r1'))?.deleted_at).toBeNull()
    await page.getByRole('button', { name: 'Delete Jam recording' }).click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await vi.waitFor(async () => expect((await db.recordings.get('r1'))?.deleted_at).not.toBeNull())
  })

  it('says an uploaded recording goes from every device', async () => {
    await db.recordings.put(recordingRow('r1', { label: 'Jam recording', state: 'ready' }))
    show()
    await page.getByRole('button', { name: 'Delete Jam recording' }).click()
    await expect.element(page.getByText(DELETE_SYNCED_NOTE)).toBeVisible()
  })

  it('closes the player before deleting the recording it holds', async () => {
    const player = fakePlayer({ item: { kind: 'recording', id: 'r1' } })
    await db.recordings.put(recordingRow('r1', { label: 'Jam recording', state: 'ready' }))
    show({ player })
    await page.getByRole('button', { name: 'Delete Jam recording' }).click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await vi.waitFor(() => expect(vi.mocked(deleteRecording)).toHaveBeenCalled())
    expect(player.close).toHaveBeenCalledOnce()
    expect(vi.mocked(player.close).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deleteRecording).mock.invocationCallOrder[0]!,
    )
  })

  it('puts a stuck upload back in the queue and starts a sync', async () => {
    const engine = fakeEngine()
    const sync = vi.spyOn(engine, 'sync')
    const serverRetry = vi.spyOn(engine, 'retry')
    await db.recordings.put(recordingRow('r1', { label: 'Jam recording', state: 'pending_upload' }))
    await db.recording_files.put(
      recordingFile('r1', { local_state: 'failed_upload', upload_attempts: 2 }),
    )
    show({ engine })
    await page.getByRole('button', { name: 'Retry uploading Jam recording' }).click()
    await vi.waitFor(() => expect(vi.mocked(retryUpload)).toHaveBeenCalledWith(db, 'r1'))
    await vi.waitFor(() => expect(sync).toHaveBeenCalledOnce())
    expect(serverRetry).not.toHaveBeenCalled()
  })

  it('asks the server to transcode a failed recording again', async () => {
    const engine = fakeEngine()
    const sync = vi.spyOn(engine, 'sync')
    const serverRetry = vi.spyOn(engine, 'retry')
    await db.recordings.put(recordingRow('r1', { label: 'Jam recording', state: 'failed' }))
    show({ engine })
    await page.getByRole('button', { name: 'Retry Jam recording' }).click()
    await vi.waitFor(() => expect(serverRetry).toHaveBeenCalledWith('r1'))
    expect(vi.mocked(retryUpload)).not.toHaveBeenCalled()
    expect(sync).not.toHaveBeenCalled()
  })

  it('adds an unfiled recording from the toolbar', async () => {
    show()
    await expect.element(page.getByText(NO_RECORDINGS_TITLE)).toBeVisible()
    const upload = page.getByRole('button', { name: 'Upload' })
    await expect.element(upload).toBeVisible()
    expect(
      (upload.element().getRootNode() as ShadowRoot).host.closest('ion-toolbar'),
    ).not.toBeNull()
    await userEvent.upload(
      page.getByLabelText(UPLOAD_AUDIO).element() as HTMLInputElement,
      new File(['abc'], 'jam.m4a', { type: 'audio/mp4' }),
    )
    await expect.element(page.getByRole('heading', { name: 'jam' })).toBeVisible()
    expect(groupNames()).toEqual(['Unfiled'])
  })

  it('shows a refused upload where the toolbar cannot', async () => {
    show()
    await expect.element(page.getByText(NO_RECORDINGS_TITLE)).toBeVisible()
    // The accept attribute is only a picker hint; drag-drop and some pickers still deliver a
    // mismatched file, so the check is bypassed here.
    await userEvent
      .setup({ applyAccept: false })
      .upload(
        page.getByLabelText(UPLOAD_AUDIO).element() as HTMLInputElement,
        new File(['x'], 'notes.txt', { type: 'text/plain' }),
      )
    const line = page.getByRole('alert')
    await expect.element(line).toHaveTextContent(NOT_AUDIO_ERROR)
    // The toolbar clips its own contents, so a message there would be a few characters wide.
    expect(line.element().closest('ion-toolbar')).toBeNull()
    expect(line.element().getBoundingClientRect().width).toBeGreaterThan(200)
  })

  it('pulls to refresh on touch and completes the refresher', async () => {
    forceTouch()
    const engine = fakeEngine()
    const sync = vi.spyOn(engine, 'sync')
    show({ engine })
    await expect.element(page.getByText(NO_RECORDINGS_TITLE)).toBeVisible()
    const refresher = document.querySelector('ion-refresher')!
    expect(refresher.parentElement?.tagName).toBe('ION-CONTENT')
    const complete = vi.fn()
    refresher.dispatchEvent(new CustomEvent('ionRefresh', { detail: { complete } }))
    await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce())
    expect(sync).toHaveBeenCalledOnce()
  })

  it("opens a group's tune from its heading, and leaves Unfiled's heading inert", async () => {
    const tuneId = await addTune("Soldier's Joy")
    await db.recordings.put(recordingRow('r1', { tune_id: tuneId, label: 'Filed take' }))
    await db.recordings.put(recordingRow('r2', { label: 'Jam recording' }))
    show({ probes: { '/recordings/:tuneId': 'Tune probe' } })
    const heading = page.getByRole('button', { name: "Open Soldier's Joy" })
    await expect.element(heading).toBeVisible()
    // Unfiled names no tune, so its heading is a label rather than a way into anything.
    expect(page.getByRole('button', { name: 'Open Unfiled' }).elements()).toEqual([])
    await heading.click()
    await expect.element(page.getByRole('heading', { name: 'Tune probe' })).toBeVisible()
  })

  it('shows one level 1 heading and nothing else while its rows load', async () => {
    // Held undefined, which is what the live query answers until it has read, so the loading
    // state stays on screen long enough to look at.
    const rows = vi.mocked(useRecordingsWithFiles)
    // restoreMocks leaves a module spy's forced return in place, so this one is put back by hand.
    const real = rows.getMockImplementation()
    rows.mockReturnValue(undefined)
    try {
      await db.recordings.put(recordingRow('r1', { label: 'Jam recording' }))
      show()
      await vi.waitFor(() => expect(document.querySelectorAll('h1')).toHaveLength(1))
      expect(page.getByRole('list').elements()).toEqual([])
      expect(page.getByText(NO_RECORDINGS_TITLE).elements()).toEqual([])
    } finally {
      rows.mockImplementation(real!)
    }
  })

  it('has one level 1 heading once loaded', async () => {
    await db.recordings.put(recordingRow('r1', { label: 'Jam recording' }))
    show()
    await expect.element(page.getByRole('heading', { name: 'Jam recording' })).toBeVisible()
    expect(document.querySelectorAll('h1')).toHaveLength(1)
  })
})
