import * as Sentry from '@sentry/react'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { alertButton, presentedModal } from '../../test/dialogs'
import { renderIonic } from '../../test/ionic'
import { jpegBlob, scanFile, scanRow } from '../../test/rows'
import { CLOSE } from '../links/linkNames'
import { deleteScanName, INVERT, SCAN_UNREADABLE } from './scanCopy'
import { SCAN_VIEW_THRESHOLD_MS, type ScanViewOrigin } from './scanViewLog'
import { ScanViewer } from './ScanViewer'

vi.mock('@sentry/react', { spy: true })

let db: CrosstuneDb

beforeEach(async () => {
  db = openTestDb()
  for (let index = 0; index < 3; index++) {
    await db.scans.put(scanRow(`p${index}`, 't1', { position: index }))
    await db.scan_files.put(scanFile(`p${index}`, await jpegBlob(60, 80)))
  }
})

function show(
  startIndex = 0,
  // A frozen clock by default, so no test that ignores views writes one while tearing down.
  {
    origin = { context: 'tune' },
    now = () => 0,
  }: { origin?: ScanViewOrigin; now?: () => number } = {},
) {
  return renderIonic(
    <ScanViewer tuneId="t1" startIndex={startIndex} origin={origin} now={now} onClose={() => {}} />,
    { db },
  )
}

function fakeClock() {
  let t = 1_000_000
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms
    },
  }
}

function setVisibility(state: DocumentVisibilityState) {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state)
  document.dispatchEvent(new Event('visibilitychange'))
}

const views = () => db.scan_views.orderBy('started_at').toArray()

const title = () => presentedModal()?.querySelector('ion-title')?.textContent
const pager = () => presentedModal()?.querySelector<HTMLElement>('[data-pager]')
const firstImage = () => presentedModal()?.querySelector<HTMLImageElement>('img')

describe('ScanViewer', () => {
  it('opens at the given scan and shows "2 of 3"', async () => {
    show(1)
    await expect.poll(title).toBe('2 of 3')
    await expect
      .poll(() => {
        const element = pager()
        return element ? Math.round(element.scrollLeft / element.clientWidth) : null
      })
      .toBe(1)
  })

  it('closing after three seconds logs one view with the context it opened from', async () => {
    const clock = fakeClock()
    show(0, { origin: { context: 'list', listId: 'list-1' }, now: clock.now })
    await expect.poll(title).toBe('1 of 3')
    clock.advance(SCAN_VIEW_THRESHOLD_MS)
    await page.getByRole('button', { name: CLOSE }).click()
    await expect.poll(views).toEqual([
      expect.objectContaining({
        tune_id: 't1',
        context: 'list',
        list_id: 'list-1',
        viewed_ms: SCAN_VIEW_THRESHOLD_MS,
        started_at: new Date(1_000_000).toISOString(),
      }),
    ])
    expect((await db.outbox.toArray()).map((entry) => entry.table)).toEqual(['scan_views'])
  })

  it('a hidden page ends the view and coming back starts a new one', async () => {
    const clock = fakeClock()
    show(0, { now: clock.now })
    await expect.poll(title).toBe('1 of 3')
    clock.advance(4_000)
    setVisibility('hidden')
    await expect.poll(views).toEqual([expect.objectContaining({ viewed_ms: 4_000 })])
    clock.advance(60_000)
    setVisibility('visible')
    clock.advance(5_000)
    await page.getByRole('button', { name: CLOSE }).click()
    await expect
      .poll(async () => (await views()).map((view) => [view.context, view.viewed_ms]))
      .toEqual([
        ['tune', 4_000],
        ['tune', 5_000],
      ])
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
    await db.scan_files.put(scanFile('p0', new Blob(['not a jpeg'], { type: 'image/jpeg' })))
    show()
    await expect.element(page.getByText(SCAN_UNREADABLE)).toBeVisible()
    await expect.poll(() => vi.mocked(Sentry.captureMessage)).toHaveBeenCalled()
    await page.getByRole('button', { name: deleteScanName(0) }).click()
    await (await alertButton('Delete')).click()
    await expect.poll(async () => (await db.scans.get('p0'))?.deleted_at).not.toBeNull()
    await expect.poll(title).toBe('1 of 2')
  })

  it("keeps a shown scan through a write to the tune's scans and files", async () => {
    show()
    await expect.poll(() => firstImage()?.src).toMatch(/^blob:/)
    const shown = firstImage()!
    const src = shown.src
    await db.scan_files.update('p0', { next_attempt_at: Date.now() + 60_000 })
    await db.scans.put(scanRow('p3', 't1', { position: 3 }))
    await expect.poll(title).toBe('1 of 4')
    expect(firstImage()).toBe(shown)
    expect(firstImage()?.src).toBe(src)
  })

  it('shows a scan again after it has been out of reach', async () => {
    show()
    const image = () =>
      presentedModal()?.querySelector<HTMLImageElement>('[data-scan-index="0"] img')
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
    // The same URL, still live: the scan came back without waiting on a second decode.
    expect(image()!.src).toBe(src)
  })
})
