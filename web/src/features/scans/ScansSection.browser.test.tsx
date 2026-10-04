import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { MAX_SCANS } from '../../commands/scans'
import { SCAN_REFUSED_ERROR, SCAN_STORAGE_FULL_ERROR, sortScans } from '../../db/scans'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { alertButton, menuItem } from '../../test/dialogs'
import { renderIonic } from '../../test/ionic'
import { dragRow } from '../../test/reorder'
import { jpegBlob, scanFile, scanRow } from '../../test/rows'
import { MOVE_DOWN } from '../lists/moveMenu'
import {
  ADD_SCANS,
  NO_SCANS_TITLE,
  SCAN_LIMIT_NOTE,
  SCAN_NOT_UPLOADED,
  SCAN_REFUSED,
  SCAN_STORAGE_FULL,
  SCAN_WAITING,
  deleteScanName,
  moveScanName,
  openScanName,
  reorderScanName,
  SCAN_UNREADABLE,
  scansNotAddedMessage,
} from './scanCopy'
import { CHOOSE_SCAN_FILES, DONE_EDITING_SCANS, EDIT_SCANS, ScansSection } from './ScansSection'
import { prepareImage, UndecodableImageError } from './prepareImage'
import { makeThumbnail } from './thumbnail'

// The first decode and encode in a loaded browser can stall past a poll's window off the main
// thread, so these tests stand in for both; prepareImage.browser.test.tsx and
// thumbnail.browser.test.tsx cover the real ones.
vi.mock('./prepareImage', { spy: true })
vi.mock('./thumbnail', { spy: true })

let db: CrosstuneDb

// By name, since a picked file reaches the input as a copy.
const sizes = new Map<string, { width: number; height: number }>()

beforeEach(() => {
  db = openTestDb()
  sizes.clear()
  vi.mocked(makeThumbnail).mockImplementation(async (blob) => blob)
  vi.mocked(prepareImage).mockImplementation(async (file) => {
    const size = sizes.get(file.name)
    if (!size) throw new UndecodableImageError(file.name, null)
    return { blob: file, ...size }
  })
})

/** A picked JPEG the stand-in prepareImage reads at its true size. */
async function jpegFile(name: string, width: number, height: number): Promise<File> {
  const file = new File([await jpegBlob(width, height)], name, { type: 'image/jpeg' })
  sizes.set(name, { width, height })
  return file
}

function show() {
  renderIonic(<ScansSection tuneId="t1" />, { db })
}

async function liveScans() {
  const rows = await db.scans.where('tune_id').equals('t1').toArray()
  return sortScans(rows.filter((row) => !row.deleted_at))
}

async function seed(count: number, extra: { files?: boolean } = {}) {
  for (let index = 0; index < count; index++) {
    const id = `p${index}`
    await db.scans.put(scanRow(id, 't1', { position: index }))
    if (extra.files) await db.scan_files.put(scanFile(id, await jpegBlob(60, 80)))
  }
}

async function pick(...files: File[]) {
  await userEvent.upload(
    page.getByLabelText(CHOOSE_SCAN_FILES).element() as HTMLInputElement,
    files,
  )
}

const shownPageIds = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-scan-id]')).map(
    (el) => el.dataset.scanId,
  )

describe('ScansSection', () => {
  it('shows Add scans with no scans', async () => {
    show()
    await expect.element(page.getByText(NO_SCANS_TITLE)).toBeVisible()
    await expect.element(page.getByRole('button', { name: ADD_SCANS })).toBeEnabled()
  })

  it('adds chosen files in order', async () => {
    show()
    await expect.element(page.getByText(NO_SCANS_TITLE)).toBeVisible()
    await pick(await jpegFile('a.jpg', 300, 400), await jpegFile('b.jpg', 400, 300))
    await expect.poll(async () => (await liveScans()).map((p) => p.width)).toEqual([300, 400])
    const stored = (await liveScans()).map((p) => p.id)
    await expect.poll(shownPageIds).toEqual(stored)
    await expect.element(page.getByRole('button', { name: openScanName(1) })).toBeVisible()
  })

  it('names a refused file and adds the rest', async () => {
    show()
    await expect.element(page.getByText(NO_SCANS_TITLE)).toBeVisible()
    await pick(
      new File(['not an image'], 'scan.heic', { type: 'image/heic' }),
      await jpegFile('a.jpg', 300, 400),
    )
    await expect.element(page.getByRole('alert')).toHaveTextContent('"scan.heic"')
    await expect.poll(async () => (await liveScans()).length).toBe(1)
  })

  it('shows a placeholder sized from width and height before download', async () => {
    await db.scans.put(scanRow('p1', 't1', { width: 600, height: 800 }))
    show()
    const placeholder = () => document.querySelector<HTMLElement>('[data-scan-placeholder]')
    await expect.poll(() => placeholder()?.getBoundingClientRect().height).toBe(120)
    await expect.poll(() => placeholder()?.getBoundingClientRect().width).toBe(90)
    await expect.poll(() => placeholder()?.querySelector('ion-spinner')).not.toBeNull()
  })

  it('shows waiting text for a scan pending on another device', async () => {
    await db.scans.put(scanRow('p1', 't1', { state: 'pending_upload' }))
    show()
    await expect.element(page.getByText(SCAN_WAITING)).toBeVisible()
  })

  it('reorders in edit mode', async () => {
    await seed(3, { files: true })
    show()
    await page.getByRole('button', { name: EDIT_SCANS }).click()
    await expect.poll(() => document.querySelector('ion-reorder-group')).not.toBeNull()
    await page.getByRole('button', { name: reorderScanName(0) }).click()
    await expect.element(page.getByRole('group', { name: moveScanName(0) })).toBeVisible()
    await (await menuItem(MOVE_DOWN)).click()
    await expect.poll(async () => (await liveScans()).map((p) => p.id)).toEqual(['p1', 'p0', 'p2'])
    await page.getByRole('button', { name: DONE_EDITING_SCANS }).click()
    await expect.poll(shownPageIds).toEqual(['p1', 'p0', 'p2'])
  })

  it('reorders by dragging the grip in edit mode', async () => {
    await seed(3, { files: true })
    show()
    await page.getByRole('button', { name: EDIT_SCANS }).click()
    await dragRow(0, 2)
    await expect.poll(async () => (await liveScans()).map((p) => p.id)).toEqual(['p1', 'p2', 'p0'])
    await page.getByRole('button', { name: DONE_EDITING_SCANS }).click()
    await expect.poll(shownPageIds).toEqual(['p1', 'p2', 'p0'])
  })

  it('deletes after confirmation', async () => {
    await seed(2, { files: true })
    show()
    await page.getByRole('button', { name: EDIT_SCANS }).click()
    await page.getByRole('button', { name: deleteScanName(0) }).click()
    await (await alertButton('Delete')).click()
    await expect.poll(async () => (await db.scans.get('p0'))?.deleted_at).not.toBeNull()
    await expect.poll(async () => (await liveScans()).map((p) => p.id)).toEqual(['p1'])
  })

  it(`disables Add at ${MAX_SCANS} scans`, async () => {
    await seed(MAX_SCANS)
    show()
    await expect.element(page.getByText(SCAN_LIMIT_NOTE)).toBeVisible()
    await expect.element(page.getByRole('button', { name: ADD_SCANS })).toBeDisabled()
  })

  it('marks a scan refused for storage as "Not uploaded, storage full"', async () => {
    await db.scans.put(scanRow('p1', 't1', { state: 'pending_upload', server_seq: 0 }))
    await db.scan_files.put(
      scanFile('p1', await jpegBlob(60, 80), {
        origin: 'captured',
        error: SCAN_STORAGE_FULL_ERROR,
      }),
    )
    show()
    await expect.element(page.getByText(SCAN_STORAGE_FULL)).toBeVisible()
  })

  it('marks a scan the server refused with a way out', async () => {
    await db.scans.put(scanRow('p1', 't1', { state: 'pending_upload', server_seq: 0 }))
    await db.scan_files.put(
      scanFile('p1', await jpegBlob(60, 80), {
        origin: 'captured',
        error: SCAN_REFUSED_ERROR,
      }),
    )
    show()
    await expect.element(page.getByText(SCAN_REFUSED)).toBeVisible()
    await page.getByRole('button', { name: EDIT_SCANS }).click()
    await expect.element(page.getByRole('button', { name: deleteScanName(0) })).toBeVisible()
  })

  it('marks a captured scan refused for any other reason as "Not uploaded yet"', async () => {
    await db.scans.put(scanRow('p1', 't1', { state: 'pending_upload' }))
    await db.scan_files.put(
      scanFile('p1', await jpegBlob(60, 80), {
        origin: 'captured',
        error: 'HTTP 413: File too large',
      }),
    )
    show()
    await expect.element(page.getByText(SCAN_NOT_UPLOADED)).toBeVisible()
  })

  it('opens the viewer at the scan tapped', async () => {
    await seed(3, { files: true })
    show()
    await page.getByRole('button', { name: openScanName(1) }).click()
    await expect
      .poll(() => document.querySelector('ion-modal ion-title')?.textContent)
      .toBe('2 of 3')
  })

  it(`stops a pick at the ${MAX_SCANS} scan limit and says how many were left out`, async () => {
    await seed(MAX_SCANS - 1)
    show()
    await expect.element(page.getByRole('button', { name: ADD_SCANS })).toBeEnabled()
    await pick(
      await jpegFile('a.jpg', 30, 40),
      await jpegFile('b.jpg', 30, 40),
      await jpegFile('c.jpg', 30, 40),
    )
    await expect.element(page.getByRole('alert')).toHaveTextContent(scansNotAddedMessage(2))
    await expect.poll(async () => (await liveScans()).length).toBe(MAX_SCANS)
  })

  it('keeps a shown thumbnail through a write to its file bookkeeping', async () => {
    await seed(1, { files: true })
    show()
    const thumbnail = () => document.querySelector<HTMLImageElement>('[data-scan-id="p0"] img')
    await expect.poll(() => thumbnail()?.src).toMatch(/^blob:/)
    const shown = thumbnail()!
    const src = shown.src
    // One write that also changes what the row shows, so the screen is known to have reread.
    await db.scan_files.update('p0', {
      next_attempt_at: Date.now() + 60_000,
      error: SCAN_STORAGE_FULL_ERROR,
    })
    await expect.element(page.getByText(SCAN_STORAGE_FULL)).toBeVisible()
    expect(thumbnail()).toBe(shown)
    expect(thumbnail()?.src).toBe(src)
  })

  it('says a scan that cannot be shown is broken', async () => {
    await db.scans.put(scanRow('p0', 't1'))
    await db.scan_files.put(scanFile('p0', new Blob(['not a jpeg'], { type: 'image/jpeg' })))
    show()
    await expect
      .element(page.getByRole('button', { name: openScanName(0) }))
      .toHaveAccessibleDescription(SCAN_UNREADABLE)
  })
})
