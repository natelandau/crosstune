import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { deleteRecording, retryUpload, updateRecording } from '../../commands/recordings'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import type { SyncEngine } from '../../sync/types'
import { openPickerRow } from '../../test/dialogs'
import { openTestDb } from '../../test/db'
import { renderScreen } from '../../test/ionic'
import { forceTouch } from '../../test/pointer'
import { fakeEngine, fakePlayer } from '../../test/providers'
import { recordingFile, recordingRow, tuneRow } from '../../test/rows'
import { NOTHING_MATCHES } from '../catalog/CatalogPage'
import { SEARCH_TUNES } from '../catalog/TuneSearch'
import type { Player } from '../player/usePlayer'
import { ADD_TO_TUNE_TITLE } from './AddToTuneSheet'
import { RECORDING_NAME_LABEL, EDIT } from './recordingCopy'
import { DELETE_SYNCED_NOTE, DELETE_UNSYNCED_NOTE } from './recordingRow'
import { EDIT_RECORDING_TITLE } from './EditRecordingSheet'
import { providerLabel } from '../links/display'
import { GO_TO_TUNE, openTuneName } from './recordingNames'
import {
  FILED_HEADER,
  FILTERS_DISABLED_REASON,
  NO_RECORDINGS_HINT,
  NO_RECORDINGS_TITLE,
  RecordingsPage,
  SEARCH_RECORDINGS,
  UNFILED_HEADER,
} from './RecordingsPage'
import { A_TO_Z, NEWEST_FIRST, OLDEST_FIRST, SORT, SORT_LABELS, Z_TO_A } from './sortCopy'
import { NOT_AUDIO_ERROR, refusedFile } from './addAudioFiles'
import { MY_RECORDINGS, SOURCE_SECTION } from './RecordingsFilterSheet'
import { META_RECORDINGS_ORIGIN, setStorage } from '../../db/meta'
import { STORAGE_USED } from './Storage'
import { UPLOAD_AUDIO } from './UploadButton'
import { DELETE_RECORDING_TITLE } from './useRecordingActions'
import { useRecordingsWithFiles } from './useRecordings'
import { CANCEL } from '../../ui/Confirm'
import { FILTERS, filtersLabel, removeFilterLabel } from '../../ui/filterCopy'

vi.mock('../../commands/recordings', { spy: true })
vi.mock('./useRecordings', { spy: true })

let db: CrosstuneDb

const SLIPPERY = providerLabel({ provider: 'slippery_hill' })

beforeEach(() => {
  db = openTestDb()
  // The sort choice is held in memory once read; a cleared-storage event resets it to the
  // default, which is what a fresh device shows.
  window.dispatchEvent(new StorageEvent('storage', { key: null }))
})

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

const filedList = () => page.getByRole('list', { name: FILED_HEADER, exact: true })
const unfiledList = () => page.getByRole('list', { name: UNFILED_HEADER, exact: true })

/** The row titles inside a list, top to bottom. */
const titlesIn = (list: ReturnType<typeof filedList>) => () =>
  Array.from(list.element().querySelectorAll('h3, h4')).map((h) => h.textContent)

/**
 * Presses a row's play control where its title shows. A mouse row's hover actions cover its
 * trailing half at this frame's width, so a press at the control's middle would land on them.
 */
async function playAtTitle(title: string) {
  // The open control's name runs on into the row's meta line.
  const play = page.getByRole('button', { name: `Play ${title}`, exact: false })
  const heading = page.getByRole('heading', { name: title, exact: true })
  await expect.element(heading).toBeVisible()
  const control = play.element().getBoundingClientRect()
  const box = heading.element().getBoundingClientRect()
  await play.click({
    position: {
      x: box.left - control.left + Math.min(box.width / 2, 16),
      y: box.top - control.top + box.height / 2,
    },
  })
}

async function pickSort(label: string) {
  await page.getByRole('button', { name: SORT }).click()
  await page.getByRole('menuitemradio', { name: label }).click()
  // The menu runs the choice once it has dismissed.
  await expect.poll(() => document.querySelector('ion-popover:not(.overlay-hidden)')).toBeNull()
}

/** A tune with a key and a user row, so its shared row has something to show. */
const addTune = (title: string, key = 'A') =>
  createTune(db, { title, key }, { status: 'known' }).then(({ tuneId }) => tuneId)

/** Fires a file drag event on the screen's empty state, as a drag from the desktop would; a leave goes to `relatedTarget`. */
function drag(type: 'dragenter' | 'dragleave' | 'drop', files: File[], relatedTarget?: Element) {
  const dataTransfer = new DataTransfer()
  for (const file of files) dataTransfer.items.add(file)
  page
    .getByText(NO_RECORDINGS_TITLE)
    .element()
    .dispatchEvent(
      new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer, relatedTarget }),
    )
}

describe('RecordingsPage', () => {
  it('names the empty state and what to do about it', async () => {
    show()
    await expect.element(page.getByText(NO_RECORDINGS_TITLE)).toBeVisible()
    await expect.element(page.getByText(NO_RECORDINGS_HINT)).toBeVisible()
  })

  it('lists unfiled recordings, then every filed one in one Filed list', async () => {
    const joy = await addTune("Soldier's Joy")
    const hen = await addTune('Cluck Old Hen')
    await db.recordings.put(
      recordingRow('r1', {
        tune_id: joy,
        label: 'Filed take',
        added_at: '2026-02-02T12:00:00.000Z',
      }),
    )
    await db.recordings.put(
      recordingRow('r3', {
        tune_id: hen,
        label: 'Hen take',
        added_at: '2026-02-03T12:00:00.000Z',
      }),
    )
    await db.recordings.put(
      recordingRow('r2', { label: 'Jam recording', added_at: '2026-01-01T12:00:00.000Z' }),
    )
    show()
    await expect.element(page.getByRole('heading', { name: 'Jam recording' })).toBeVisible()
    await expect.poll(groupNames).toEqual([UNFILED_HEADER, FILED_HEADER])
    // Newest added first by default, whatever the tune.
    await expect.poll(titlesIn(filedList())).toEqual(['Hen take', 'Filed take'])
    // Each filed row names its own tune, as a line that opens it.
    await expect
      .element(filedList().getByRole('button', { name: openTuneName("Soldier's Joy") }))
      .toBeVisible()
    await expect
      .element(filedList().getByRole('button', { name: openTuneName('Cluck Old Hen') }))
      .toBeVisible()
    expect(
      unfiledList()
        .getByRole('button', { name: /^Open / })
        .elements(),
    ).toEqual([])
  })

  it('titles an unlabeled filed recording by its date, never by its tune', async () => {
    const tuneId = await addTune("Soldier's Joy")
    await db.recordings.put(
      recordingRow('r1', {
        tune_id: tuneId,
        label: null,
        recorded_at: '2026-03-14T20:05:00.000Z',
      }),
    )
    show()
    await expect.element(filedList()).toBeVisible()
    // The browser project runs in the machine's own zone, so the date itself is not asserted.
    const row = page.getByRole('heading', { name: 'Recording, ', exact: false, level: 3 })
    await expect.element(row).toBeVisible()
    const title = row.element().textContent!
    // The tune line names the tune, so the title does not.
    expect(title).not.toContain("Soldier's Joy")
    await expect
      .element(page.getByRole('button', { name: openTuneName("Soldier's Joy") }))
      .toBeVisible()
    // The row's actions are named from the same title.
    await expect.element(page.getByRole('button', { name: `${EDIT} ${title}` })).toBeInTheDocument()
  })

  it('reorders by title from the Sort menu, and reverses on a second pick', async () => {
    const tuneId = await addTune("Soldier's Joy")
    await db.recordings.bulkPut([
      recordingRow('r1', {
        tune_id: tuneId,
        label: 'Bravo',
        added_at: '2026-01-03T12:00:00.000Z',
      }),
      recordingRow('r2', {
        tune_id: tuneId,
        label: 'Alpha',
        added_at: '2026-01-01T12:00:00.000Z',
      }),
      recordingRow('r3', {
        tune_id: tuneId,
        label: 'Charlie',
        added_at: '2026-01-02T12:00:00.000Z',
      }),
    ])
    show()
    await expect.poll(titlesIn(filedList())).toEqual(['Bravo', 'Charlie', 'Alpha'])
    await pickSort(SORT_LABELS.title)
    await expect.poll(titlesIn(filedList())).toEqual(['Alpha', 'Bravo', 'Charlie'])
    await pickSort(SORT_LABELS.title)
    await expect.poll(titlesIn(filedList())).toEqual(['Charlie', 'Bravo', 'Alpha'])
  })

  it('marks the current sort in its menu', async () => {
    await db.recordings.put(recordingRow('r1', { label: 'Jam recording' }))
    show()
    await page.getByRole('button', { name: SORT }).click()
    await expect
      .element(page.getByRole('menuitemradio', { name: SORT_LABELS.added }))
      .toHaveAttribute('aria-checked', 'true')
    await expect
      .element(page.getByRole('menuitemradio', { name: SORT_LABELS.tune }))
      .toHaveAttribute('aria-checked', 'false')
  })

  it("shows the current sort's direction on its checked item", async () => {
    await db.recordings.put(recordingRow('r1', { label: 'Jam recording' }))
    show()
    const checked = () => {
      const item = document.querySelector('ion-popover:not(.overlay-hidden) [aria-checked="true"]')
      if (!item) return null
      const arrow = item.querySelector('svg.lucide-arrow-up, svg.lucide-arrow-down')
      return [
        item.querySelector('[data-menu-label]')?.textContent,
        item.getAttribute('aria-description'),
        arrow?.classList.contains('lucide-arrow-up') ? 'up' : arrow ? 'down' : null,
      ]
    }
    const openSort = () => page.getByRole('button', { name: SORT }).click()
    await openSort()
    await expect.poll(checked).toEqual([SORT_LABELS.added, NEWEST_FIRST, 'down'])
    // Only the checked item shows a direction.
    expect(
      document.querySelectorAll(
        'ion-popover svg.lucide-arrow-up, ion-popover svg.lucide-arrow-down',
      ),
    ).toHaveLength(1)
    await page.getByRole('menuitemradio', { name: SORT_LABELS.added }).click()
    await expect.poll(() => document.querySelector('ion-popover:not(.overlay-hidden)')).toBeNull()
    await openSort()
    await expect.poll(checked).toEqual([SORT_LABELS.added, OLDEST_FIRST, 'up'])
    await page.getByRole('menuitemradio', { name: SORT_LABELS.recorded }).click()
    await expect.poll(() => document.querySelector('ion-popover:not(.overlay-hidden)')).toBeNull()
    await openSort()
    await expect.poll(checked).toEqual([SORT_LABELS.recorded, NEWEST_FIRST, 'down'])
    await page.getByRole('menuitemradio', { name: SORT_LABELS.title }).click()
    await expect.poll(() => document.querySelector('ion-popover:not(.overlay-hidden)')).toBeNull()
    await openSort()
    await expect.poll(checked).toEqual([SORT_LABELS.title, A_TO_Z, 'up'])
    await page.getByRole('menuitemradio', { name: SORT_LABELS.title }).click()
    await expect.poll(() => document.querySelector('ion-popover:not(.overlay-hidden)')).toBeNull()
    await openSort()
    await expect.poll(checked).toEqual([SORT_LABELS.title, Z_TO_A, 'down'])
  })

  it('orders by date recorded with unknown dates last, and shows that date', async () => {
    await db.recordings.bulkPut([
      recordingRow('r1', {
        label: 'Newest added, date unknown',
        added_at: '2026-01-03T12:00:00.000Z',
        recorded_at: null,
        recorded_precision: null,
      }),
      recordingRow('r2', {
        label: 'Old take',
        added_at: '2026-01-01T12:00:00.000Z',
        recorded_at: '1937-01-01T00:00:00.000Z',
        recorded_precision: 'year',
      }),
      recordingRow('r3', {
        label: 'Later take',
        added_at: '2026-01-02T12:00:00.000Z',
        recorded_at: '1998-05-01T00:00:00.000Z',
        recorded_precision: 'month',
      }),
    ])
    show()
    await expect
      .poll(titlesIn(unfiledList()))
      .toEqual(['Newest added, date unknown', 'Later take', 'Old take'])
    await expect.poll(() => unfiledList().element().textContent).toContain('Added ')
    await expect.poll(() => unfiledList().element().textContent).not.toContain('1937')
    await pickSort(SORT_LABELS.recorded)
    await expect
      .poll(titlesIn(unfiledList()))
      .toEqual(['Later take', 'Old take', 'Newest added, date unknown'])
    await expect.poll(() => unfiledList().element().textContent).toContain('1937')
    await expect.poll(() => unfiledList().element().textContent).toContain('May 1998')
  })

  it('keeps the sort choice across leaving and coming back', async () => {
    const tuneId = await addTune("Soldier's Joy")
    await db.recordings.bulkPut([
      recordingRow('r1', {
        tune_id: tuneId,
        label: 'Bravo',
        added_at: '2026-01-03T12:00:00.000Z',
      }),
      recordingRow('r2', {
        tune_id: tuneId,
        label: 'Alpha',
        added_at: '2026-01-01T12:00:00.000Z',
      }),
    ])
    const { unmount } = show()
    await pickSort(SORT_LABELS.title)
    await expect.poll(titlesIn(filedList())).toEqual(['Alpha', 'Bravo'])
    unmount()
    show()
    await expect.poll(titlesIn(filedList())).toEqual(['Alpha', 'Bravo'])
  })

  it('heads each tune inside Filed under the Tune sort', async () => {
    const joy = await addTune("Soldier's Joy")
    const hen = await addTune('Cluck Old Hen')
    await db.recordings.bulkPut([
      recordingRow('r1', {
        tune_id: joy,
        label: 'Joy take',
        added_at: '2026-01-03T12:00:00.000Z',
      }),
      recordingRow('r2', {
        tune_id: hen,
        label: 'Hen take',
        added_at: '2026-01-01T12:00:00.000Z',
      }),
      recordingRow('r3', { label: 'Jam recording' }),
    ])
    show({ probes: { '/recordings/:tuneId': 'Tune probe' } })
    await expect.element(page.getByRole('heading', { name: 'Joy take' })).toBeVisible()
    await pickSort(SORT_LABELS.tune)
    const heading = filedList().getByRole('heading', { name: "Soldier's Joy", level: 3 })
    await expect.element(heading).toBeVisible()
    await expect.poll(groupNames).toEqual([UNFILED_HEADER, FILED_HEADER])
    // Tunes from A, each heading above its own rows, all in the one card.
    await expect
      .poll(titlesIn(filedList()))
      .toEqual(['Cluck Old Hen', 'Hen take', "Soldier's Joy", 'Joy take'])
    await expect
      .element(filedList().getByRole('heading', { name: 'Joy take', level: 4 }))
      .toBeVisible()
    // The heading above names the tune, so its rows carry no tune line of their own: the one
    // Open control per tune is the heading's.
    await expect
      .poll(
        () =>
          filedList()
            .getByRole('button', { name: openTuneName("Soldier's Joy") })
            .elements().length,
      )
      .toBe(1)
    await expect
      .poll(
        () =>
          filedList()
            .getByRole('button', { name: openTuneName("Soldier's Joy") })
            .element()
            .getBoundingClientRect().height,
      )
      .toBeGreaterThanOrEqual(44)
    await filedList()
      .getByRole('button', { name: openTuneName("Soldier's Joy") })
      .click()
    await expect.element(page.getByRole('heading', { name: 'Tune probe' })).toBeVisible()
  })

  it('finds recordings by label or tune title, across both lists', async () => {
    const tuneId = await addTune("Soldier's Joy")
    await db.recordings.bulkPut([
      recordingRow('r1', { tune_id: tuneId, label: 'Filed take' }),
      recordingRow('r2', { label: 'Jam recording' }),
      recordingRow('r3', { label: 'Soldier warmup' }),
    ])
    show()
    await expect.element(page.getByRole('heading', { name: 'Jam recording' })).toBeVisible()
    const search = page.getByRole('searchbox', { name: SEARCH_RECORDINGS })
    await search.fill('joy')
    await expect.poll(groupNames).toEqual([FILED_HEADER])
    await expect.element(page.getByRole('heading', { name: 'Filed take' })).toBeVisible()
    await expect
      .element(page.getByRole('heading', { name: 'Jam recording' }))
      .not.toBeInTheDocument()
    await search.fill('SOLDIER')
    await expect.poll(groupNames).toEqual([UNFILED_HEADER, FILED_HEADER])
    await expect.poll(titlesIn(unfiledList())).toEqual(['Soldier warmup'])
    await search.fill('zzz')
    await expect.element(page.getByText(NOTHING_MATCHES)).toBeVisible()
    await expect.poll(groupNames).toEqual([])
    expect(page.getByText(NO_RECORDINGS_TITLE).elements()).toEqual([])
  })

  it('keeps the search across leaving and coming back in the same session', async () => {
    await db.recordings.bulkPut([
      recordingRow('r1', { label: 'Jam recording' }),
      recordingRow('r2', { label: 'Barn dance' }),
    ])
    const { unmount } = show()
    await page.getByRole('searchbox', { name: SEARCH_RECORDINGS }).fill('barn')
    await expect.poll(titlesIn(unfiledList())).toEqual(['Barn dance'])
    unmount()
    show()
    await expect
      .element(page.getByRole('searchbox', { name: SEARCH_RECORDINGS }))
      .toHaveValue('barn')
    await expect.poll(titlesIn(unfiledList())).toEqual(['Barn dance'])
  })

  it('keeps playing a recording the search hides', async () => {
    const player = fakePlayer()
    const tuneId = await addTune("Soldier's Joy")
    await db.recordings.put(recordingRow('r1', { tune_id: tuneId, label: 'Filed take' }))
    await db.recordings.put(recordingRow('r2', { label: 'Jam recording' }))
    await db.recording_files.put(
      recordingFile('r1', { blob: new Blob(['abc']), local_state: 'uploaded' }),
    )
    show({ player })
    await playAtTitle('Filed take')
    await expect.poll(() => player.play).toHaveBeenCalledWith({ kind: 'recording', id: 'r1' })
    await page.getByRole('searchbox', { name: SEARCH_RECORDINGS }).fill('jam')
    await expect.element(page.getByRole('heading', { name: 'Filed take' })).not.toBeInTheDocument()
    await expect.poll(groupNames).toEqual([UNFILED_HEADER])
    expect(player.close).not.toHaveBeenCalled()
    expect(player.play).toHaveBeenCalledOnce()
  })

  it('keeps playing a recording the sort moves', async () => {
    const player = fakePlayer()
    const tuneId = await addTune("Soldier's Joy")
    await db.recordings.bulkPut([
      recordingRow('r1', {
        tune_id: tuneId,
        label: 'Bravo',
        added_at: '2026-01-03T12:00:00.000Z',
      }),
      recordingRow('r2', {
        tune_id: tuneId,
        label: 'Alpha',
        added_at: '2026-01-01T12:00:00.000Z',
      }),
    ])
    await db.recording_files.put(
      recordingFile('r1', { blob: new Blob(['abc']), local_state: 'uploaded' }),
    )
    show({ player })
    await playAtTitle('Bravo')
    await expect.poll(() => player.play).toHaveBeenCalledWith({ kind: 'recording', id: 'r1' })
    await pickSort(SORT_LABELS.title)
    await expect.poll(titlesIn(filedList())).toEqual(['Alpha', 'Bravo'])
    await pickSort(SORT_LABELS.tune)
    await expect.poll(titlesIn(filedList())).toEqual(["Soldier's Joy", 'Bravo', 'Alpha'])
    expect(player.close).not.toHaveBeenCalled()
    expect(player.play).toHaveBeenCalledOnce()
  })

  it("opens a filed recording's tune from its tune line and from Go to tune", async () => {
    const tuneId = await addTune("Soldier's Joy")
    await db.recordings.put(recordingRow('r1', { tune_id: tuneId, label: 'Filed take' }))
    const first = show({ probes: { '/recordings/:tuneId': 'Tune probe' } })
    await page.getByRole('button', { name: openTuneName("Soldier's Joy") }).click()
    await expect.element(page.getByRole('heading', { name: 'Tune probe' })).toBeVisible()
    first.unmount()
    show({ probes: { '/recordings/:tuneId': 'Tune probe' } })
    await page.getByRole('button', { name: `${GO_TO_TUNE} Filed take` }).click()
    await expect.element(page.getByRole('heading', { name: 'Tune probe' })).toBeVisible()
  })

  it('lays its groups out as cards on the grouped surface', async () => {
    await db.recordings.put(recordingRow('r1', { label: 'Jam recording' }))
    show()
    await expect.element(page.getByRole('heading', { name: 'Jam recording' })).toBeVisible()
    const item = document.querySelector('ion-item')!
    await expect
      .poll(() => document.querySelector('ion-content')!.classList.contains('grouped'))
      .toBe(true)
    await vi.waitFor(() => {
      expect(item.closest('ion-list')!.classList.contains('list-inset')).toBe(true)
    })
  })

  it('files a recording as unfiled once its tune is deleted elsewhere', async () => {
    await db.tunes.put(tuneRow('s1', "Soldier's Joy", { deleted_at: '2026-02-01T00:00:00.000Z' }))
    await db.recordings.put(recordingRow('r1', { tune_id: 's1', label: 'Jam recording' }))
    show()
    await expect.element(page.getByRole('heading', { name: 'Jam recording' })).toBeVisible()
    await expect.poll(groupNames).toEqual([UNFILED_HEADER])
    expect(page.getByRole('button', { name: openTuneName("Soldier's Joy") }).elements()).toEqual([])
  })

  it('offers Edit, filing, and Delete on a row', async () => {
    await db.recordings.put(recordingRow('r1', { label: 'Jam recording' }))
    show()
    await expect
      .element(page.getByRole('button', { name: `${EDIT} Jam recording` }))
      .toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: 'Add to tune Jam recording' }))
      .toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: 'Delete Jam recording' }))
      .toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: /^Rename / })).not.toBeInTheDocument()
  })

  it('edits a recording from its own row', async () => {
    await db.recordings.put(recordingRow('r1', { label: 'Jam recording' }))
    show()
    await page.getByRole('button', { name: `${EDIT} Jam recording` }).click()
    await expect.element(page.getByText(EDIT_RECORDING_TITLE)).toBeVisible()
    const field = page.getByRole('textbox', { name: RECORDING_NAME_LABEL })
    await expect.element(field).toHaveValue('Jam recording')
    await field.fill('Barn dance')
    await page.getByRole('button', { name: 'Save' }).click()
    await vi.waitFor(async () => expect((await db.recordings.get('r1'))?.label).toBe('Barn dance'))
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
    await expect.poll(() => line.element().closest('ion-item')).toBeNull()
  })

  it('warns that a recording held only here cannot be recovered, and asks first', async () => {
    await db.recordings.put(recordingRow('r1', { label: 'Jam recording', state: 'pending_upload' }))
    await db.recording_files.put(recordingFile('r1', { local_state: 'captured' }))
    show()
    await page.getByRole('button', { name: 'Delete Jam recording' }).click()
    await expect.element(page.getByText(DELETE_RECORDING_TITLE)).toBeVisible()
    await expect.element(page.getByText(DELETE_UNSYNCED_NOTE)).toBeVisible()
    await page.getByRole('button', { name: CANCEL }).click()
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
    await expect.poll(() => player.close).toHaveBeenCalledOnce()
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
    await expect
      .poll(() => (upload.element().getRootNode() as ShadowRoot).host.closest('ion-toolbar'))
      .not.toBeNull()
    await userEvent.upload(
      page.getByLabelText(UPLOAD_AUDIO).element() as HTMLInputElement,
      new File(['abc'], 'jam.m4a', { type: 'audio/mp4' }),
    )
    await expect.element(page.getByRole('heading', { name: 'jam' })).toBeVisible()
    await expect.poll(groupNames).toEqual(['Unfiled'])
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
    await expect.poll(() => line.element().closest('ion-toolbar')).toBeNull()
    await expect.poll(() => line.element().getBoundingClientRect().width).toBeGreaterThan(200)
  })

  it('adds every audio file dropped on the screen, and names the one it refused', async () => {
    show()
    await expect.element(page.getByText(NO_RECORDINGS_TITLE)).toBeVisible()
    drag('drop', [
      new File(['abc'], 'jam.m4a', { type: 'audio/mp4' }),
      new File(['x'], 'notes.txt', { type: 'text/plain' }),
      new File(['abc'], 'reel.wav', { type: 'audio/wav' }),
    ])
    await expect.element(page.getByRole('heading', { name: 'jam' })).toBeVisible()
    await expect.element(page.getByRole('heading', { name: 'reel' })).toBeVisible()
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(refusedFile('notes.txt', NOT_AUDIO_ERROR))
  })

  it('outlines the screen while files are dragged over it', async () => {
    show()
    await expect.element(page.getByText(NO_RECORDINGS_TITLE)).toBeVisible()
    const outlined = () => document.querySelector('[data-file-drop]') !== null
    drag('dragenter', [new File(['abc'], 'jam.m4a', { type: 'audio/mp4' })])
    await expect.poll(outlined).toBe(true)
    // Into a child of the screen: still over it.
    drag('dragleave', [], page.getByText(NO_RECORDINGS_HINT).element())
    await expect.poll(outlined).toBe(true)
    // Out of the screen altogether, from wherever the pointer last was.
    drag('dragleave', [], document.body)
    await expect.poll(outlined).toBe(false)
  })

  it('pulls to refresh on touch and completes the refresher', async () => {
    forceTouch()
    const engine = fakeEngine()
    const sync = vi.spyOn(engine, 'sync')
    show({ engine })
    await expect.element(page.getByText(NO_RECORDINGS_TITLE)).toBeVisible()
    await expect
      .poll(() => document.querySelector('ion-refresher')?.parentElement?.tagName)
      .toBe('ION-CONTENT')
    const refresher = document.querySelector('ion-refresher')!
    const complete = vi.fn()
    refresher.dispatchEvent(new CustomEvent('ionRefresh', { detail: { complete } }))
    await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce())
    await expect.poll(() => sync).toHaveBeenCalledOnce()
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
    await expect.poll(() => document.querySelectorAll('h1')).toHaveLength(1)
  })

  describe('source filter', () => {
    const filters = (name = FILTERS) => page.getByRole('button', { name, exact: true })
    const searchRow = () =>
      page.getByRole('searchbox', { name: SEARCH_RECORDINGS }).element().closest('ion-toolbar')!
    const removeFilter = (value: string) =>
      page.getByRole('button', { name: removeFilterLabel(value), exact: true })

    async function chooseSource(value: string) {
      await filters().click()
      await openPickerRow(SOURCE_SECTION, { exact: false })
      await page.getByRole('radio', { name: value, exact: true }).click()
      await expect.poll(() => document.querySelector('ion-popover:not(.overlay-hidden)')).toBeNull()
      await page.getByRole('button', { name: 'Done' }).click()
      await expect.poll(() => document.querySelector('ion-modal:not(.overlay-hidden)')).toBeNull()
    }

    it('puts Sort in the search row, just before Filters', async () => {
      await db.recordings.put(recordingRow('r1', { label: 'Take' }))
      show()
      const sort = page.getByRole('button', { name: SORT })
      await expect.element(sort).toBeVisible()
      await expect.element(page.getByRole('searchbox', { name: SEARCH_RECORDINGS })).toBeVisible()
      const hostOf = (element: Element) => (element.getRootNode() as ShadowRoot).host
      await expect.poll(() => hostOf(sort.element()).closest('ion-toolbar')).toBe(searchRow())
      await vi.waitFor(() => {
        const sortBox = hostOf(sort.element()).getBoundingClientRect()
        const filtersBox = hostOf(filters().element()).getBoundingClientRect()
        expect(sortBox.width).toBeGreaterThan(0)
        expect(sortBox.right).toBeLessThanOrEqual(filtersBox.left + 1)
      })
    })

    it('puts Filters at the trailing edge of the search row', async () => {
      await db.recordings.put(
        recordingRow('r1', { label: 'Imported take', origin: 'slippery_hill' }),
      )
      show()
      await expect.element(filters()).toBeEnabled()
      // An ion-button keeps its native button in a shadow root, which `closest` never leaves.
      const host = () => (filters().element().getRootNode() as ShadowRoot).host
      await expect
        .poll(() => host().closest('ion-buttons[slot="end"]')?.closest('ion-toolbar'))
        .toBe(searchRow())
      await vi.waitFor(() => {
        const field = page.getByRole('searchbox', { name: SEARCH_RECORDINGS }).element()
        const fieldBox = field.getBoundingClientRect()
        const control = host().getBoundingClientRect()
        expect(control.width).toBeGreaterThan(0)
        expect(fieldBox.right).toBeLessThanOrEqual(control.left + 1)
      })
    })

    it('keeps Filters disabled and silent while the recordings load and while there are none', async () => {
      let release = () => {}
      const gate = new Promise<void>((resolve) => (release = resolve))
      const get = db.meta.get.bind(db.meta) as (key: string) => Promise<unknown>
      vi.spyOn(db.meta, 'get').mockImplementation(((key: string) =>
        key === META_RECORDINGS_ORIGIN ? gate.then(() => get(key)) : get(key)) as never)
      await db.recordings.put(
        recordingRow('r1', { label: 'Imported take', origin: 'slippery_hill' }),
      )
      show()
      await expect.element(filters()).toBeDisabled()
      await expect.element(filters()).toHaveAccessibleDescription('')
      release()
      await expect.element(filters()).toBeEnabled()
      await db.recordings.clear()
      await expect.element(page.getByText(NO_RECORDINGS_TITLE)).toBeVisible()
      await expect.element(filters()).toBeDisabled()
      await expect.element(filters()).toHaveAccessibleDescription('')
    })

    it('disables Filters while every recording is own, and says why', async () => {
      await db.recordings.put(recordingRow('r1', { label: 'Jam recording' }))
      show()
      await expect.element(page.getByRole('heading', { name: 'Jam recording' })).toBeVisible()
      await expect.element(filters()).toBeDisabled()
      await expect.element(filters()).toHaveAccessibleDescription(FILTERS_DISABLED_REASON)
    })

    it('enables Filters and drops its reason once an import arrives', async () => {
      await db.recordings.put(recordingRow('r1', { label: 'Jam recording' }))
      show()
      await expect.element(filters()).toBeDisabled()
      await db.recordings.put(
        recordingRow('r2', { label: 'Imported take', origin: 'slippery_hill' }),
      )
      await expect.element(filters()).toBeEnabled()
      await expect.element(filters()).toHaveAccessibleDescription('')
    })

    it('narrows from the sheet, counts the set filter, and removes it from its capsule', async () => {
      const tuneId = await addTune("Soldier's Joy")
      await db.recordings.put(recordingRow('r1', { label: 'Jam recording' }))
      await db.recordings.put(
        recordingRow('r2', { tune_id: tuneId, label: 'Imported take', origin: 'slippery_hill' }),
      )
      show()
      await expect.poll(groupNames).toEqual([UNFILED_HEADER, FILED_HEADER])
      await chooseSource(SLIPPERY)
      await expect.poll(groupNames).toEqual([FILED_HEADER])
      await expect.element(filters(filtersLabel(1))).toBeVisible()
      await expect
        .element(page.getByRole('heading', { name: 'Jam recording' }))
        .not.toBeInTheDocument()
      await removeFilter(SLIPPERY).click()
      await expect.poll(groupNames).toEqual([UNFILED_HEADER, FILED_HEADER])
      await expect.element(filters()).toBeVisible()
      await expect.element(removeFilter(SLIPPERY)).not.toBeInTheDocument()
      await chooseSource(MY_RECORDINGS)
      await expect.poll(groupNames).toEqual([UNFILED_HEADER])
      await expect.element(removeFilter(MY_RECORDINGS)).toBeVisible()
    })

    it('keeps the choice across a remount', async () => {
      await db.recordings.put(recordingRow('r1', { label: 'Jam recording' }))
      await db.recordings.put(
        recordingRow('r2', { label: 'Imported take', origin: 'slippery_hill' }),
      )
      const first = show()
      await chooseSource(SLIPPERY)
      await expect
        .poll(async () => (await db.meta.get(META_RECORDINGS_ORIGIN))?.value)
        .toBe('slippery_hill')
      await first.unmount()
      show()
      await expect.element(removeFilter(SLIPPERY)).toBeVisible()
      await expect.element(page.getByRole('heading', { name: 'Imported take' })).toBeVisible()
      await expect
        .element(page.getByRole('heading', { name: 'Jam recording' }))
        .not.toBeInTheDocument()
    })

    it('puts the set filter above the storage summary', async () => {
      await setStorage(db, {
        used_bytes: 1_000_000,
        quota_bytes: 2_000_000,
        max_file_bytes: 500_000,
      })
      await db.meta.put({ key: META_RECORDINGS_ORIGIN, value: 'slippery_hill' })
      await db.recordings.put(
        recordingRow('r1', { label: 'Imported take', origin: 'slippery_hill' }),
      )
      show()
      const storage = page.getByRole('progressbar', { name: STORAGE_USED })
      await expect.element(removeFilter(SLIPPERY)).toBeVisible()
      await expect.element(storage).toBeInTheDocument()
      expect(
        removeFilter(SLIPPERY).element().compareDocumentPosition(storage.element()) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    })

    it('keeps a chosen source set once none of its recordings remain', async () => {
      await db.meta.put({ key: META_RECORDINGS_ORIGIN, value: 'slippery_hill' })
      await db.recordings.put(recordingRow('r1', { label: 'Jam recording' }))
      show()
      await expect.element(removeFilter(SLIPPERY)).toBeVisible()
      await expect.element(filters(filtersLabel(1))).toBeEnabled()
      await expect.poll(groupNames).toEqual([])
      await expect.element(page.getByText(NOTHING_MATCHES)).toBeVisible()
      expect(page.getByText(NO_RECORDINGS_TITLE).elements()).toEqual([])
      await removeFilter(SLIPPERY).click()
      await expect.element(page.getByRole('heading', { name: 'Jam recording' })).toBeVisible()
      await expect.element(filters()).toBeDisabled()
    })

    it('says nothing matches when search and source together leave nothing', async () => {
      await db.meta.put({ key: META_RECORDINGS_ORIGIN, value: 'slippery_hill' })
      await db.recordings.put(recordingRow('r1', { label: 'Jam recording' }))
      await db.recordings.put(
        recordingRow('r2', { label: 'Imported take', origin: 'slippery_hill' }),
      )
      show()
      await expect.element(page.getByRole('heading', { name: 'Imported take' })).toBeVisible()
      await page.getByRole('searchbox', { name: SEARCH_RECORDINGS }).fill('jam')
      await expect.poll(groupNames).toEqual([])
      await expect.element(page.getByText(NOTHING_MATCHES)).toBeVisible()
    })

    it('still lists recordings when the stored choice cannot be read', async () => {
      const get = db.meta.get.bind(db.meta) as (key: string) => Promise<unknown>
      vi.spyOn(db.meta, 'get').mockImplementation(((key: string) =>
        key === META_RECORDINGS_ORIGIN
          ? Promise.reject(new Error('store failed'))
          : get(key)) as never)
      await db.recordings.put(recordingRow('r1', { label: 'Jam recording' }))
      show()
      await expect.element(page.getByRole('heading', { name: 'Jam recording' })).toBeVisible()
    })
  })
})
