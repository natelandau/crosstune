import { beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { CrosstuneDb } from '../../../db/schema'
import type { SyncEngine } from '../../../sync/types'
import { destination } from '../../../layout/destinations'
import { openTestDb } from '../../../test/db'
import { renderApp } from '../../../test/renderApp'
import { recordingFile, recordingRow } from '../../../test/rows'
import { CANCEL, CONTINUE } from '../../../ui/confirmCopy'
import { MORE_ACTIONS } from '../../../ui/menuCopy'
import { selectedTitle } from '../../selection/selectionCopy'
import { exportProgress } from '../../settings/export/exportCopy'
import { downloadBlob } from '../../settings/export/runExport'
import { DOWNLOAD } from '../recordingNames'
import { SELECT_RECORDINGS } from '../recordingsCopy'
import { exportLeftOut, exportSkipped, SHARE, TRY_AGAIN } from './exportCopy'

vi.mock('../../settings/export/runExport', { spy: true })

const WIDE = { width: 1280, height: 800 }
const RECORDINGS = destination('recordings')

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
  vi.mocked(downloadBlob).mockImplementation(() => {})
})

/** Replaces the browser's file sharing for one test. */
function stubShare(canShare: ((data: ShareData) => boolean) | undefined) {
  const share = vi.fn(async (_data: ShareData) => {})
  Object.defineProperty(navigator, 'canShare', { value: canShare, configurable: true })
  Object.defineProperty(navigator, 'share', { value: share, configurable: true })
  onTestFinished(() => {
    delete (navigator as { canShare?: unknown }).canShare
    delete (navigator as { share?: unknown }).share
  })
  return share
}

/** A fetch per call that settles only when the test says. */
function heldFetches() {
  const pending: { resolve: (blob: Blob) => void; reject: (cause: unknown) => void }[] = []
  const fetchFile = vi.fn(
    (_kind: string, _id: string, signal?: AbortSignal) =>
      new Promise<Blob>((resolve, reject) => {
        pending.push({ resolve, reject })
        signal?.addEventListener('abort', () => reject(signal.reason))
      }),
  )
  return { fetchFile, pending }
}

async function show(fetchFile: SyncEngine['fetchFile']) {
  await renderApp({ path: RECORDINGS.root, db, frame: WIDE, sync: { fetchFile } })
}

const row = (name: string) => page.getByRole('row', { name: new RegExp(`^${name}`) })
const title = (n: number) => page.getByText(selectedTitle(n), { exact: true })
const button = (name: string) => page.getByRole('button', { name, exact: true })
const sheet = () => page.getByRole('dialog', { name: DOWNLOAD })

async function select(...names: string[]) {
  await expect.element(row(names[0]!)).toBeVisible()
  await page.getByRole('button', { name: MORE_ACTIONS }).click()
  await page.getByRole('menuitem', { name: SELECT_RECORDINGS }).click()
  for (const name of names) await row(name).click()
  await expect.element(title(names.length)).toBeVisible()
}

const local = (id: string) =>
  recordingFile(id, { blob: new Blob([id], { type: 'audio/mp4' }), local_state: 'uploaded' })

/** Two recordings on the server only, and one still recording on this device. */
async function seedWithCapture() {
  await db.recordings.bulkPut([
    recordingRow('a', { label: 'Alpha take' }),
    recordingRow('b', { label: 'Bravo take' }),
    recordingRow('c', { label: 'Capture take', state: 'pending_upload' }),
  ])
  await db.recording_files.put(recordingFile('c', { local_state: 'capturing' }))
}

it('offers Share only where the browser can share and every selected file is here', async () => {
  stubShare(() => true)
  await db.recordings.bulkPut([
    recordingRow('a', { label: 'Alpha take' }),
    recordingRow('b', { label: 'Bravo take' }),
    recordingRow('s', { label: 'Server take' }),
  ])
  await db.recording_files.bulkPut([local('a'), local('b')])
  await show(vi.fn())
  await select('Alpha take', 'Bravo take')
  await expect.element(button(DOWNLOAD)).toBeVisible()
  await expect.element(button(SHARE)).toBeVisible()
  await row('Server take').click()
  await expect.element(title(3)).toBeVisible()
  await expect.element(button(SHARE)).not.toBeInTheDocument()
  await expect.element(button(DOWNLOAD)).toBeVisible()
})

it('shares each selected file, not a zip, and leaves selecting', async () => {
  const share = stubShare(() => true)
  await db.recordings.bulkPut([
    recordingRow('a', { label: 'Alpha take' }),
    recordingRow('b', { label: 'Bravo take' }),
  ])
  await db.recording_files.bulkPut([local('a'), local('b')])
  await show(vi.fn())
  await select('Alpha take', 'Bravo take')

  await button(SHARE).click()
  await expect.poll(() => share.mock.calls.length).toBe(1)
  const files = share.mock.calls[0]![0].files!
  expect(files.map((file) => file.type)).toEqual(['audio/mp4', 'audio/mp4'])
  expect(await Promise.all(files.map((file) => file.text()))).toEqual(
    expect.arrayContaining(['a', 'b']),
  )
  await expect.element(title(2)).not.toBeInTheDocument()
  expect(downloadBlob).not.toHaveBeenCalled()
})

it("drops a failed share's error once the mode is left", async () => {
  const share = stubShare(() => true)
  share.mockRejectedValueOnce(new Error('Sharing failed'))
  await db.recordings.put(recordingRow('a', { label: 'Alpha take' }))
  await db.recording_files.put(local('a'))
  await show(vi.fn())
  await select('Alpha take')

  await button(SHARE).click()
  await expect.element(page.getByText('Sharing failed')).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(title(1)).not.toBeInTheDocument()
  await page.getByRole('button', { name: MORE_ACTIONS }).click()
  await page.getByRole('menuitem', { name: SELECT_RECORDINGS }).click()
  await expect.element(button(DOWNLOAD)).toBeVisible()
  await expect.element(page.getByText('Sharing failed')).not.toBeInTheDocument()
})

it('offers no Share where the browser cannot share the files', async () => {
  stubShare(() => false)
  await db.recordings.put(recordingRow('a', { label: 'Alpha take' }))
  await db.recording_files.put(local('a'))
  await show(vi.fn())
  await select('Alpha take')
  await expect.element(button(DOWNLOAD)).toBeVisible()
  await expect.element(button(SHARE)).not.toBeInTheDocument()
})

it('says how many are skipped, exports none on Cancel, and the rest on Continue', async () => {
  stubShare(undefined)
  await seedWithCapture()
  const { fetchFile, pending } = heldFetches()
  await show(fetchFile)
  await select('Alpha take', 'Bravo take', 'Capture take')

  await button(DOWNLOAD).click()
  await expect.element(sheet()).toHaveTextContent(exportSkipped(1, 3))
  await sheet().getByRole('button', { name: CANCEL }).click()
  await expect.element(sheet()).not.toBeInTheDocument()
  expect(fetchFile).not.toHaveBeenCalled()
  await expect.element(title(3)).toBeVisible()

  await button(DOWNLOAD).click()
  await sheet().getByRole('button', { name: CONTINUE }).click()
  await expect.poll(() => pending.length).toBe(1)
  pending[0]!.resolve(new Blob(['a'], { type: 'audio/mp4' }))
  await expect.element(sheet().getByRole('status')).toHaveTextContent(exportProgress(1, 2))
  await expect.poll(() => pending.length).toBe(2)
  pending[1]!.resolve(new Blob(['b'], { type: 'audio/mp4' }))

  await expect.poll(() => vi.mocked(downloadBlob).mock.calls.length).toBe(1)
  expect(fetchFile.mock.calls.map((call) => call[1]).sort()).toEqual(['a', 'b'])
  expect(vi.mocked(downloadBlob).mock.calls[0]![1]).toMatch(
    /^crosstune-recordings-\d{4}-\d{2}-\d{2}\.zip$/,
  )
  await expect.element(title(3)).not.toBeInTheDocument()
  await expect.element(sheet()).not.toBeInTheDocument()
})

it('keeps what the sheet said it skips when the connection returns', async () => {
  stubShare(undefined)
  const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  await db.recordings.bulkPut([
    recordingRow('a', { label: 'Alpha take' }),
    recordingRow('s', { label: 'Server take' }),
  ])
  await db.recording_files.put(local('a'))
  const fetchFile = vi.fn()
  await show(fetchFile)
  await select('Alpha take', 'Server take')

  await button(DOWNLOAD).click()
  await expect.element(sheet()).toHaveTextContent(exportSkipped(1, 2))
  onLine.mockReturnValue(true)
  window.dispatchEvent(new Event('online'))
  await sheet().getByRole('button', { name: CONTINUE }).click()

  await expect.poll(() => vi.mocked(downloadBlob).mock.calls.length).toBe(1)
  expect(fetchFile).not.toHaveBeenCalled()
  await expect.element(sheet()).not.toBeInTheDocument()
})

it('downloads nothing and stays selecting when cancelled during progress', async () => {
  stubShare(undefined)
  await db.recordings.bulkPut([
    recordingRow('a', { label: 'Alpha take' }),
    recordingRow('b', { label: 'Bravo take' }),
  ])
  const { fetchFile, pending } = heldFetches()
  await show(fetchFile)
  await select('Alpha take', 'Bravo take')

  await button(DOWNLOAD).click()
  await expect.poll(() => pending.length).toBe(1)
  await expect.element(sheet().getByRole('status')).toHaveTextContent(exportProgress(0, 2))
  await sheet().getByRole('button', { name: CANCEL }).click()
  await expect.element(sheet()).not.toBeInTheDocument()
  await expect.poll(() => fetchFile.mock.calls[0]![2]?.aborted).toBe(true)
  pending[0]!.resolve(new Blob(['a'], { type: 'audio/mp4' }))

  await expect.element(title(2)).toBeVisible()
  expect(fetchFile).toHaveBeenCalledTimes(1)
  expect(downloadBlob).not.toHaveBeenCalled()
})

it('leaves out a recording whose download fails and says so at the end', async () => {
  stubShare(undefined)
  await db.recordings.bulkPut([
    recordingRow('a', { label: 'Alpha take' }),
    recordingRow('b', { label: 'Bravo take' }),
  ])
  const fetched = new Blob(['b'], { type: 'audio/mp4' })
  const fetchFile = vi.fn(async (_kind: string, id: string) => {
    if (id === 'a') throw new Error('unreachable')
    return fetched
  })
  await show(fetchFile)
  await select('Alpha take', 'Bravo take')

  await button(DOWNLOAD).click()
  await expect.poll(() => vi.mocked(downloadBlob).mock.calls.length).toBe(1)
  expect(vi.mocked(downloadBlob).mock.calls[0]![0]).toBe(fetched)
  await expect.element(page.getByText(exportLeftOut(1))).toBeVisible()
  await expect.element(title(2)).not.toBeInTheDocument()
})

it('tries the same recordings again after every download fails', async () => {
  stubShare(undefined)
  await db.recordings.bulkPut([
    recordingRow('a', { label: 'Alpha take' }),
    recordingRow('b', { label: 'Bravo take' }),
  ])
  const { fetchFile, pending } = heldFetches()
  await show(fetchFile)
  await select('Alpha take', 'Bravo take')

  await button(DOWNLOAD).click()
  await expect.poll(() => pending.length).toBe(1)
  pending[0]!.reject(new Error('unreachable'))
  await expect.poll(() => pending.length).toBe(2)
  pending[1]!.reject(new Error('unreachable'))
  await expect.element(sheet().getByText('unreachable')).toBeVisible()

  await sheet().getByRole('button', { name: TRY_AGAIN }).click()
  await expect.poll(() => pending.length).toBe(3)
  await expect.element(sheet().getByRole('status')).toHaveTextContent(exportProgress(0, 2))
  await expect.element(sheet().getByText('unreachable')).not.toBeInTheDocument()
  pending[2]!.resolve(new Blob(['a'], { type: 'audio/mp4' }))
  await expect.poll(() => pending.length).toBe(4)
  pending[3]!.resolve(new Blob(['b'], { type: 'audio/mp4' }))

  await expect.poll(() => vi.mocked(downloadBlob).mock.calls.length).toBe(1)
  expect(fetchFile.mock.calls.map((call) => call[1]).sort()).toEqual(['a', 'a', 'b', 'b'])
  await expect.element(sheet()).not.toBeInTheDocument()
})
