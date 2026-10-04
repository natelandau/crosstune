import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { MAX_NOTATION_PAGES } from '../../commands/notation'
import { NOTATION_REFUSED_ERROR, NOTATION_STORAGE_FULL_ERROR, sortPages } from '../../db/notation'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { alertButton, menuItem } from '../../test/dialogs'
import { renderIonic } from '../../test/ionic'
import { dragRow } from '../../test/reorder'
import { jpegBlob, notationFile, notationPageRow } from '../../test/rows'
import { MOVE_DOWN } from '../lists/moveMenu'
import {
  ADD_NOTATION,
  NO_NOTATION_TITLE,
  NOTATION_LIMIT_NOTE,
  NOTATION_NOT_UPLOADED,
  NOTATION_REFUSED,
  NOTATION_STORAGE_FULL,
  NOTATION_WAITING,
  openPageName,
  PAGE_UNREADABLE,
  pagesNotAddedMessage,
} from './notationCopy'
import {
  CHOOSE_NOTATION_FILES,
  DONE_EDITING_NOTATION,
  EDIT_NOTATION,
  NotationSection,
} from './NotationSection'
import { prepareImage, UndecodableImageError } from './prepareImage'

// The first decode and encode in a loaded browser can stall past a poll's window off the main
// thread, so these tests stand in for it; prepareImage.browser.test.tsx covers the real one.
vi.mock('./prepareImage', { spy: true })

let db: CrosstuneDb

// By name, since a picked file reaches the input as a copy.
const sizes = new Map<string, { width: number; height: number }>()

beforeEach(() => {
  db = openTestDb()
  sizes.clear()
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
  renderIonic(<NotationSection tuneId="t1" />, { db })
}

async function livePages() {
  const rows = await db.notation_pages.where('tune_id').equals('t1').toArray()
  return sortPages(rows.filter((row) => !row.deleted_at))
}

async function seed(count: number, extra: { files?: boolean } = {}) {
  for (let index = 0; index < count; index++) {
    const id = `p${index}`
    await db.notation_pages.put(notationPageRow(id, 't1', { position: index }))
    if (extra.files) await db.notation_files.put(notationFile(id, await jpegBlob(60, 80)))
  }
}

async function pick(...files: File[]) {
  await userEvent.upload(
    page.getByLabelText(CHOOSE_NOTATION_FILES).element() as HTMLInputElement,
    files,
  )
}

const shownPageIds = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-page-id]')).map(
    (el) => el.dataset.pageId,
  )

describe('NotationSection', () => {
  it('shows Add notation with no pages', async () => {
    show()
    await expect.element(page.getByText(NO_NOTATION_TITLE)).toBeVisible()
    await expect.element(page.getByRole('button', { name: ADD_NOTATION })).toBeEnabled()
  })

  it('adds chosen files in order', async () => {
    show()
    await expect.element(page.getByText(NO_NOTATION_TITLE)).toBeVisible()
    await pick(await jpegFile('a.jpg', 300, 400), await jpegFile('b.jpg', 400, 300))
    await expect.poll(async () => (await livePages()).map((p) => p.width)).toEqual([300, 400])
    const stored = (await livePages()).map((p) => p.id)
    await expect.poll(shownPageIds).toEqual(stored)
    await expect.element(page.getByRole('button', { name: openPageName(1) })).toBeVisible()
  })

  it('names a refused file and adds the rest', async () => {
    show()
    await expect.element(page.getByText(NO_NOTATION_TITLE)).toBeVisible()
    await pick(
      new File(['not an image'], 'scan.heic', { type: 'image/heic' }),
      await jpegFile('a.jpg', 300, 400),
    )
    await expect.element(page.getByRole('alert')).toHaveTextContent('"scan.heic"')
    await expect.poll(async () => (await livePages()).length).toBe(1)
  })

  it('shows a placeholder sized from width and height before download', async () => {
    await db.notation_pages.put(notationPageRow('p1', 't1', { width: 600, height: 800 }))
    show()
    const placeholder = () => document.querySelector<HTMLElement>('[data-page-placeholder]')
    await expect.poll(() => placeholder()?.getBoundingClientRect().height).toBe(120)
    await expect.poll(() => placeholder()?.getBoundingClientRect().width).toBe(90)
    await expect.poll(() => placeholder()?.querySelector('ion-spinner')).not.toBeNull()
  })

  it('shows waiting text for a page pending on another device', async () => {
    await db.notation_pages.put(notationPageRow('p1', 't1', { state: 'pending_upload' }))
    show()
    await expect.element(page.getByText(NOTATION_WAITING)).toBeVisible()
  })

  it('reorders in edit mode', async () => {
    await seed(3, { files: true })
    show()
    await page.getByRole('button', { name: EDIT_NOTATION }).click()
    await expect.poll(() => document.querySelector('ion-reorder-group')).not.toBeNull()
    await page.getByRole('button', { name: 'Reorder page 1' }).click()
    await (await menuItem(MOVE_DOWN)).click()
    await expect.poll(async () => (await livePages()).map((p) => p.id)).toEqual(['p1', 'p0', 'p2'])
    await page.getByRole('button', { name: DONE_EDITING_NOTATION }).click()
    await expect.poll(shownPageIds).toEqual(['p1', 'p0', 'p2'])
  })

  it('reorders by dragging the grip in edit mode', async () => {
    await seed(3, { files: true })
    show()
    await page.getByRole('button', { name: EDIT_NOTATION }).click()
    await dragRow(0, 2)
    await expect.poll(async () => (await livePages()).map((p) => p.id)).toEqual(['p1', 'p2', 'p0'])
    await page.getByRole('button', { name: DONE_EDITING_NOTATION }).click()
    await expect.poll(shownPageIds).toEqual(['p1', 'p2', 'p0'])
  })

  it('deletes after confirmation', async () => {
    await seed(2, { files: true })
    show()
    await page.getByRole('button', { name: EDIT_NOTATION }).click()
    await page.getByRole('button', { name: 'Delete page 1' }).click()
    await (await alertButton('Delete')).click()
    await expect.poll(async () => (await db.notation_pages.get('p0'))?.deleted_at).not.toBeNull()
    await expect.poll(async () => (await livePages()).map((p) => p.id)).toEqual(['p1'])
  })

  it(`disables Add at ${MAX_NOTATION_PAGES} pages`, async () => {
    await seed(MAX_NOTATION_PAGES)
    show()
    await expect.element(page.getByText(NOTATION_LIMIT_NOTE)).toBeVisible()
    await expect.element(page.getByRole('button', { name: ADD_NOTATION })).toBeDisabled()
  })

  it('marks a page refused for storage as "Not uploaded, storage full"', async () => {
    await db.notation_pages.put(
      notationPageRow('p1', 't1', { state: 'pending_upload', server_seq: 0 }),
    )
    await db.notation_files.put(
      notationFile('p1', await jpegBlob(60, 80), {
        origin: 'captured',
        error: NOTATION_STORAGE_FULL_ERROR,
      }),
    )
    show()
    await expect.element(page.getByText(NOTATION_STORAGE_FULL)).toBeVisible()
  })

  it('marks a page the server refused with a way out', async () => {
    await db.notation_pages.put(
      notationPageRow('p1', 't1', { state: 'pending_upload', server_seq: 0 }),
    )
    await db.notation_files.put(
      notationFile('p1', await jpegBlob(60, 80), {
        origin: 'captured',
        error: NOTATION_REFUSED_ERROR,
      }),
    )
    show()
    await expect.element(page.getByText(NOTATION_REFUSED)).toBeVisible()
    await page.getByRole('button', { name: EDIT_NOTATION }).click()
    await expect.element(page.getByRole('button', { name: 'Delete page 1' })).toBeVisible()
  })

  it('marks a captured page refused for any other reason as "Not uploaded yet"', async () => {
    await db.notation_pages.put(notationPageRow('p1', 't1', { state: 'pending_upload' }))
    await db.notation_files.put(
      notationFile('p1', await jpegBlob(60, 80), {
        origin: 'captured',
        error: 'HTTP 413: File too large',
      }),
    )
    show()
    await expect.element(page.getByText(NOTATION_NOT_UPLOADED)).toBeVisible()
  })

  it('opens the viewer at the page tapped', async () => {
    await seed(3, { files: true })
    show()
    await page.getByRole('button', { name: openPageName(1) }).click()
    await expect
      .poll(() => document.querySelector('ion-modal ion-title')?.textContent)
      .toBe('2 of 3')
  })

  it(`stops a pick at the ${MAX_NOTATION_PAGES} page limit and says how many were left out`, async () => {
    await seed(MAX_NOTATION_PAGES - 1)
    show()
    await expect.element(page.getByRole('button', { name: ADD_NOTATION })).toBeEnabled()
    await pick(
      await jpegFile('a.jpg', 30, 40),
      await jpegFile('b.jpg', 30, 40),
      await jpegFile('c.jpg', 30, 40),
    )
    await expect.element(page.getByRole('alert')).toHaveTextContent(pagesNotAddedMessage(2))
    await expect.poll(async () => (await livePages()).length).toBe(MAX_NOTATION_PAGES)
  })

  it('keeps a shown thumbnail through a write to its file bookkeeping', async () => {
    await seed(1, { files: true })
    show()
    const thumbnail = () => document.querySelector<HTMLImageElement>('[data-page-id="p0"] img')
    await expect.poll(() => thumbnail()?.src).toMatch(/^blob:/)
    const shown = thumbnail()!
    const src = shown.src
    // One write that also changes what the row shows, so the screen is known to have reread.
    await db.notation_files.update('p0', {
      next_attempt_at: Date.now() + 60_000,
      error: NOTATION_STORAGE_FULL_ERROR,
    })
    await expect.element(page.getByText(NOTATION_STORAGE_FULL)).toBeVisible()
    expect(thumbnail()).toBe(shown)
    expect(thumbnail()?.src).toBe(src)
  })

  it('never draws a thumbnail larger than its page', async () => {
    await db.notation_pages.put(notationPageRow('p0', 't1', { width: 60, height: 80 }))
    await db.notation_files.put(notationFile('p0', await jpegBlob(60, 80)))
    show()
    const thumbnail = () => document.querySelector<HTMLImageElement>('[data-page-id="p0"] img')
    await expect.poll(() => thumbnail()?.naturalHeight).toBe(80)
  })

  it('says a page that cannot be shown is broken', async () => {
    await db.notation_pages.put(notationPageRow('p0', 't1'))
    await db.notation_files.put(
      notationFile('p0', new Blob(['not a jpeg'], { type: 'image/jpeg' })),
    )
    show()
    await expect
      .element(page.getByRole('button', { name: openPageName(0) }))
      .toHaveAccessibleDescription(PAGE_UNREADABLE)
  })
})
