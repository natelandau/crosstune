import { beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { RecordingFile } from '../../db/recordings'
import { destination } from '../../layout/destinations'
import { recordingPath } from '../../layout/tuneHome'
import { openTestDb } from '../../test/db'
import { entitlementRow, recordingFile, recordingRow } from '../../test/rows'
import { renderApp } from '../../test/renderApp'
import { CANCEL } from '../../ui/confirmCopy'
import { MORE_ACTIONS } from '../../ui/menuCopy'
import { AnalyticsProvider } from '../../usage/AnalyticsProvider'
import { recordingAnalytics } from '../../usage/testing'
import { EXPORT_BLOCK_REASONS, SHARE, TRY_AGAIN } from '../recordings/export/exportCopy'
import { DOWNLOAD } from '../recordings/recordingNames'
import { exportProgress } from '../settings/export/exportCopy'
import { downloadBlob } from '../settings/export/runExport'

vi.mock('../settings/export/runExport', { spy: true })

const RECORDINGS = destination('recordings')
const FETCHED = new Blob(['fetched'], { type: 'audio/mp4' })

beforeEach(() => {
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

/** A free plan's page of one recording: on the server only, or still uploading from `file`. */
async function mount(
  file: Partial<RecordingFile> | null,
  fetchFile: (kind: string, id: string, signal?: AbortSignal) => Promise<Blob> = vi.fn(
    async () => FETCHED,
  ),
) {
  const db = openTestDb()
  await db.entitlements.put(entitlementRow())
  await db.recordings.put(
    recordingRow('rA', { label: 'Jam', state: file ? 'pending_upload' : 'ready' }),
  )
  if (file) await db.recording_files.put(recordingFile('rA', file))
  const analytics = recordingAnalytics()
  await renderApp({
    path: recordingPath(RECORDINGS.root, 'rA'),
    db,
    sync: { fetchFile },
    wrap: (app) => <AnalyticsProvider client={analytics}>{app}</AnalyticsProvider>,
  })
  await page.getByRole('main').getByRole('button', { name: MORE_ACTIONS }).click()
  return { fetchFile, analytics, db }
}

const item = (name: string) => page.getByRole('menuitem', { name, exact: true })
const sheet = () => page.getByRole('dialog', { name: DOWNLOAD })
const exported = (analytics: ReturnType<typeof recordingAnalytics>) =>
  analytics.sends().filter((send) => send.name === 'recording_exported')

it('downloads a recording this device does not hold on a free plan, with progress', async () => {
  stubShare(undefined)
  const held = heldFetches()
  const { fetchFile, analytics } = await mount(null, held.fetchFile)
  await expect.element(item(DOWNLOAD)).not.toHaveAttribute('aria-disabled', 'true')
  await expect.element(item(SHARE)).not.toBeInTheDocument()
  await item(DOWNLOAD).click()
  await expect.element(sheet().getByRole('status')).toHaveTextContent(exportProgress(0, 1))
  await expect.poll(() => held.pending.length).toBe(1)
  held.pending[0]!.resolve(FETCHED)
  await expect.poll(() => vi.mocked(downloadBlob).mock.calls.length).toBe(1)
  await expect.element(sheet()).not.toBeInTheDocument()
  expect(fetchFile).toHaveBeenCalledWith('recording', 'rA', expect.any(AbortSignal))
  expect(vi.mocked(downloadBlob).mock.calls[0]![0]).toBe(FETCHED)
  await expect
    .poll(() => exported(analytics))
    .toEqual([
      {
        name: 'recording_exported',
        props: {
          method: 'download',
          count_bucket: '1-9',
          fetched_bucket: '1-9',
          skipped_bucket: '0',
        },
      },
    ])
})

it('downloads nothing when the download is cancelled while it fetches', async () => {
  stubShare(undefined)
  // Ignores the abort, so only the export's own cancel keeps a late file from downloading.
  let deliver = (_blob: Blob) => {}
  const fetchFile = vi.fn(
    (_kind: string, _id: string, _signal?: AbortSignal) =>
      new Promise<Blob>((resolve) => (deliver = resolve)),
  )
  await mount(null, fetchFile)
  await item(DOWNLOAD).click()
  await expect.poll(() => fetchFile.mock.calls.length).toBe(1)
  await sheet().getByRole('button', { name: CANCEL }).click()
  await expect.element(sheet()).not.toBeInTheDocument()
  await expect.poll(() => fetchFile.mock.calls[0]![2]?.aborted).toBe(true)
  deliver(FETCHED)
  await fetchFile.mock.results[0]!.value
  // A task boundary runs every continuation the resolved fetch queued.
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(fetchFile).toHaveBeenCalledTimes(1)
  expect(downloadBlob).not.toHaveBeenCalled()
})

it('shows why a download failed and tries it again', async () => {
  stubShare(undefined)
  const { fetchFile, pending } = heldFetches()
  await mount(null, fetchFile)
  await item(DOWNLOAD).click()
  await expect.poll(() => pending.length).toBe(1)
  pending[0]!.reject(new Error('unreachable'))
  await expect.element(sheet().getByText('unreachable')).toBeVisible()
  await expect.element(page.getByRole('main').getByText('unreachable')).not.toBeInTheDocument()

  await sheet().getByRole('button', { name: TRY_AGAIN }).click()
  await expect.poll(() => pending.length).toBe(2)
  pending[1]!.resolve(FETCHED)
  await expect.poll(() => vi.mocked(downloadBlob).mock.calls.length).toBe(1)
  await expect.element(sheet()).not.toBeInTheDocument()
})

it('downloads a recording this device holds at once, with no sheet', async () => {
  stubShare(undefined)
  const blob = new Blob(['local'], { type: 'audio/mp4' })
  const { fetchFile } = await mount({ blob, local_state: 'uploaded' })
  await item(DOWNLOAD).click()
  await expect.poll(() => vi.mocked(downloadBlob).mock.calls.length).toBe(1)
  expect(await vi.mocked(downloadBlob).mock.calls[0]![0].text()).toBe('local')
  expect(fetchFile).not.toHaveBeenCalled()
  await expect.element(sheet()).not.toBeInTheDocument()
})

it('shares a recording this device holds where the browser can share it', async () => {
  const share = stubShare(() => true)
  const blob = new Blob(['local'], { type: 'audio/mp4' })
  const { analytics } = await mount({ blob, local_state: 'uploaded' })
  await item(SHARE).click()
  await expect.poll(() => share.mock.calls.length).toBe(1)
  const [file] = share.mock.calls[0]![0].files!
  expect(await file!.text()).toBe('local')
  await expect
    .poll(() => exported(analytics).map((send) => send.props))
    .toEqual([expect.objectContaining({ method: 'share', fetched_bucket: '0' })])
})

it('offers no Share for a recording this device does not hold', async () => {
  stubShare(() => true)
  await mount(null)
  await expect.element(item(DOWNLOAD)).toBeVisible()
  await expect.element(item(SHARE)).not.toBeInTheDocument()
})

it('shows Download disabled, with why, while the recording is still recording', async () => {
  stubShare(() => true)
  await mount({ blob: new Blob(['x'], { type: 'audio/mp4' }), local_state: 'capturing' })
  await expect.element(item(DOWNLOAD)).toHaveAttribute('aria-disabled', 'true')
  await expect.element(page.getByText(EXPORT_BLOCK_REASONS.capturing)).toBeVisible()
  await expect.element(item(SHARE)).not.toBeInTheDocument()
})

it.each([
  { audio: 'held here', drop: false },
  { audio: 'fetched', drop: true },
])('downloads audio $audio while a share is still open', async ({ drop }) => {
  const share = stubShare(() => true)
  share.mockImplementation(() => new Promise<void>(() => {}))
  const blob = new Blob(['local'], { type: 'audio/mp4' })
  const { fetchFile, db } = await mount({ blob, local_state: 'uploaded' })
  await item(SHARE).click()
  await expect.poll(() => share.mock.calls.length).toBe(1)
  if (drop) {
    // The audio leaves this device while the share is open, so Download must fetch it.
    await db.recording_files.delete('rA')
    await db.recordings.update('rA', { state: 'ready' })
  }
  await page.getByRole('main').getByRole('button', { name: MORE_ACTIONS }).click()
  await item(DOWNLOAD).click()
  await expect.poll(() => vi.mocked(downloadBlob).mock.calls.length).toBe(1)
  expect(fetchFile).toHaveBeenCalledTimes(drop ? 1 : 0)
  await expect.element(sheet()).not.toBeInTheDocument()
})
