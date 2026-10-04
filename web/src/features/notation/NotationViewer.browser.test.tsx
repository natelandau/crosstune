import * as Sentry from '@sentry/react'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { alertButton, presentedModal } from '../../test/dialogs'
import { renderIonic } from '../../test/ionic'
import { jpegBlob, notationFile, notationPageRow } from '../../test/rows'
import { INVERT, PAGE_UNREADABLE } from './notationCopy'
import { NotationViewer } from './NotationViewer'

vi.mock('@sentry/react', { spy: true })

let db: CrosstuneDb

beforeEach(async () => {
  db = openTestDb()
  for (let index = 0; index < 3; index++) {
    await db.notation_pages.put(notationPageRow(`p${index}`, 't1', { position: index }))
    await db.notation_files.put(notationFile(`p${index}`, await jpegBlob(60, 80)))
  }
})

function show(startIndex = 0) {
  return renderIonic(<NotationViewer tuneId="t1" startIndex={startIndex} onClose={() => {}} />, {
    db,
  })
}

const title = () => presentedModal()?.querySelector('ion-title')?.textContent
const pager = () => presentedModal()?.querySelector<HTMLElement>('[data-pager]')
const firstImage = () => presentedModal()?.querySelector<HTMLImageElement>('img')

describe('NotationViewer', () => {
  it('opens at the given page and shows "2 of 3"', async () => {
    show(1)
    await expect.poll(title).toBe('2 of 3')
    await expect
      .poll(() => {
        const element = pager()
        return element ? Math.round(element.scrollLeft / element.clientWidth) : null
      })
      .toBe(1)
  })

  it('invert persists across remount', async () => {
    const { unmount } = show()
    await expect.poll(firstImage).not.toBeNull()
    await page.getByRole('button', { name: INVERT }).click()
    await expect.poll(() => getComputedStyle(firstImage()!).filter).toContain('invert')
    unmount()
    await expect.poll(presentedModal).toBeNull()
    show()
    await expect
      .poll(() => firstImage() && getComputedStyle(firstImage()!).filter)
      .toContain('invert')
    await expect
      .element(page.getByRole('button', { name: INVERT }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('holds a wake lock while open', async () => {
    const request = vi.fn(() =>
      Promise.resolve(
        Object.assign(new EventTarget(), { released: false, release: () => Promise.resolve() }),
      ),
    )
    const original = Object.getOwnPropertyDescriptor(navigator, 'wakeLock')
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } })
    onTestFinished(() => {
      if (original) Object.defineProperty(navigator, 'wakeLock', original)
      else Reflect.deleteProperty(navigator, 'wakeLock')
    })
    show()
    await expect.poll(title).toBe('1 of 3')
    await expect.poll(() => request).toHaveBeenCalledWith('screen')
  })

  it('shows a broken tile with Delete for an undecodable blob and reports it to Sentry', async () => {
    await db.notation_files.put(
      notationFile('p0', new Blob(['not a jpeg'], { type: 'image/jpeg' })),
    )
    show()
    await expect.element(page.getByText(PAGE_UNREADABLE)).toBeVisible()
    await expect.poll(() => vi.mocked(Sentry.captureMessage)).toHaveBeenCalled()
    await page.getByRole('button', { name: 'Delete page 1' }).click()
    await (await alertButton('Delete')).click()
    await expect.poll(async () => (await db.notation_pages.get('p0'))?.deleted_at).not.toBeNull()
    await expect.poll(title).toBe('1 of 2')
  })

  it("keeps a shown page through a write to the tune's pages and files", async () => {
    show()
    await expect.poll(() => firstImage()?.src).toMatch(/^blob:/)
    const shown = firstImage()!
    const src = shown.src
    await db.notation_files.update('p0', { next_attempt_at: Date.now() + 60_000 })
    await db.notation_pages.put(notationPageRow('p3', 't1', { position: 3 }))
    await expect.poll(title).toBe('1 of 4')
    expect(firstImage()).toBe(shown)
    expect(firstImage()?.src).toBe(src)
  })

  it('shows a page again after it has been out of reach', async () => {
    show()
    const image = () =>
      presentedModal()?.querySelector<HTMLImageElement>('[data-page-index="0"] img')
    await expect.poll(() => image()?.naturalWidth).toBeGreaterThan(0)
    const src = image()!.src
    const scrollTo = (index: number) => {
      const element = pager()!
      element.scrollLeft = index * element.clientWidth
    }
    scrollTo(2)
    await expect.poll(title).toBe('3 of 3')
    await expect.poll(image).toBeNull()
    scrollTo(0)
    await expect.poll(title).toBe('1 of 3')
    await expect.poll(() => image()?.complete && image()!.naturalWidth).toBeGreaterThan(0)
    // The same URL, still live: the page came back without waiting on a second decode.
    expect(image()!.src).toBe(src)
  })
})
