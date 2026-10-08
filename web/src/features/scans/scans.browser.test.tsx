import { page, userEvent } from 'vitest/browser'
import { expect, it, onTestFinished, vi } from 'vitest'
import { render } from '@testing-library/react'
import { deleteScan } from '../../commands/scans'
import { sortScans } from '../../db/scans'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalList, LocalListItem } from '../../db/types'
import { MOVE_DOWN } from '../../ui/moveMenu'
import {
  DONE_EDITING_SCANS,
  EDIT_SCANS,
  INVERT,
  moveScanName,
  NEXT_SCAN,
  openScanName,
  PREVIOUS_SCAN,
  scanCount,
  scanMovedAnnouncement,
  scanName,
  SCANS,
  scanViewerName,
  ZOOM,
} from './scanCopy'
import { DOUBLE_TAP_MS } from './useScanViewer'
import { EDIT_TUNE } from '../tune/tuneScreenCopy'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { jpegBlob, scanFile, scanRow, tuneRow, userTuneRow } from '../../test/rows'
import { CLOSE } from '../../ui/confirmCopy'

import { swipeLeft, tap } from '../../test/gestures'
import { stampAxes } from '../../test/render'
import { renderApp } from '../../test/renderApp'
import { AppMotion } from '../../theme/motion'
import { TUNE } from '../tune/tunePageCopy'
import { ConfirmProvider } from '../../ui/Confirm'
import { ScanViewer } from './ScanViewer'
import { TUNE_LIST } from '../catalog/catalogCopy'

const PHONE = { width: 390, height: 844 }
const WIDE = { width: 1280, height: 800 }
const AT = '2025-03-04T12:00:00.000Z'
const TITLE = "Soldier's Joy"

/** A tune with three scans, p0 to p2 in order, and two tunes with none. */
async function seed(db: CrosstuneDb) {
  await db.tunes.bulkPut([
    tuneRow('t1', TITLE, { key: 'D' }),
    tuneRow('t2', 'Cluck Old Hen'),
    tuneRow('t3', 'Turkey in the Straw'),
  ])
  await db.user_tunes.bulkPut([
    userTuneRow('u-t1', 't1'),
    userTuneRow('u-t2', 't2'),
    userTuneRow('u-t3', 't3'),
  ])
  for (let index = 0; index < 3; index++) {
    await db.scans.put(scanRow(`p${index}`, 't1', { position: index }))
    await db.scan_files.put(scanFile(`p${index}`, await jpegBlob(60, 80)))
  }
}

async function mount(path: string, frame = PHONE, density: 'touch' | 'pointer' = 'touch') {
  const db = openTestDb()
  await seed(db)
  const app = await renderApp({ path, db, frame, density })
  return { ...app, db }
}

const viewer = () => page.getByRole('dialog', { name: scanViewerName(TITLE) })
const pager = () => viewer().element().querySelector<HTMLElement>('[data-pager]')
const pageShown = () => {
  const element = pager()
  return element && element.clientWidth > 0
    ? Math.round(element.scrollLeft / element.clientWidth)
    : null
}
const scansSection = () =>
  page.getByRole('main', { name: TUNE }).getByRole('region', { name: SCANS })
const thumbnail = (index: number) =>
  scansSection().getByRole('button', { name: openScanName(index), exact: true })
const thumbnailOrder = () =>
  [...scansSection().element().querySelectorAll<HTMLElement>('li[data-scan-id]')].map(
    (item) => item.dataset.scanId,
  )

it('opens the viewer from a thumbnail at that scan, over the whole window', async () => {
  await mount('/catalog/t1')
  await thumbnail(1).click()
  await expect.element(viewer()).toBeVisible()
  await expect.element(viewer().getByText(scanCount(1, 3), { exact: true })).toBeVisible()
  await expect.poll(pageShown).toBe(1)
  await expect
    .poll(() => {
      const box = viewer().element().getBoundingClientRect()
      return [box.left, box.top, box.width, box.height]
    })
    .toEqual([0, 0, PHONE.width, PHONE.height])
})

it('pages with Next scan and Previous scan on pointer', async () => {
  await mount('/catalog/t1', WIDE, 'pointer')
  await thumbnail(0).click()
  await expect.element(viewer().getByText(scanCount(0, 3), { exact: true })).toBeVisible()
  await viewer().getByRole('button', { name: NEXT_SCAN }).click()
  await expect.element(viewer().getByText(scanCount(1, 3), { exact: true })).toBeVisible()
  await expect.poll(pageShown).toBe(1)
  await viewer().getByRole('button', { name: PREVIOUS_SCAN }).click()
  await expect.element(viewer().getByText(scanCount(0, 3), { exact: true })).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(viewer()).not.toBeInTheDocument()
})

it('offers paging controls on touch too, under the scans', async () => {
  await mount('/catalog/t1')
  await thumbnail(0).click()
  const image = viewer().getByRole('img', { name: scanName(0) })
  await expect.element(image).toBeVisible()
  await viewer().getByRole('button', { name: NEXT_SCAN }).click()
  await expect.element(viewer().getByText(scanCount(1, 3), { exact: true })).toBeVisible()
  await expect.element(viewer().getByRole('button', { name: PREVIOUS_SCAN })).toBeVisible()
  const controls = viewer().element().querySelector('[data-scan-controls]')!
  const shown = viewer().getByRole('img', { name: scanName(1) })
  await expect.element(shown).toBeVisible()
  // The scan sizes to the space above the bar rather than running under it.
  await expect
    .poll(
      () => shown.element().getBoundingClientRect().bottom <= controls.getBoundingClientRect().top,
    )
    .toBe(true)
})

it('zooms on a double tap, timed on the injected clock', async () => {
  const db = openTestDb()
  await seed(db)
  let t = 1_000_000
  stampAxes({ density: 'touch' })
  render(
    <AppMotion>
      <ConfirmProvider>
        <ScanViewer
          tuneId="t1"
          startIndex={0}
          origin={{ context: 'tune' }}
          isOpen
          onOpenChange={() => {}}
          now={() => t}
        />
      </ConfirmProvider>
    </AppMotion>,
    { wrapper: dataProviders({ db }) },
  )
  const image = viewer().getByRole('img', { name: scanName(0) })
  await expect.element(image).toBeVisible()
  const zoom = viewer().getByRole('button', { name: ZOOM })
  // Taps a full window apart are single taps. Had the first two made a pair, the last two
  // would make another and zoom back out.
  await tap(image)
  t += DOUBLE_TAP_MS
  await tap(image)
  t += DOUBLE_TAP_MS
  await tap(image)
  t += DOUBLE_TAP_MS - 1
  await tap(image)
  await expect.element(zoom).toHaveAttribute('aria-pressed', 'true')
})

it('zooms the scan to twice its fitted width and back', async () => {
  await mount('/catalog/t1')
  await thumbnail(0).click()
  const image = viewer().getByRole('img', { name: scanName(0) })
  await expect.element(image).toBeVisible()
  const fitted = image.element().getBoundingClientRect().width
  const zoom = viewer().getByRole('button', { name: ZOOM })
  await zoom.click()
  await expect.element(zoom).toHaveAttribute('aria-pressed', 'true')
  await expect
    .poll(() => Math.round(image.element().getBoundingClientRect().width))
    .toBe(Math.round(fitted * 2))
  await zoom.click()
  await expect.element(zoom).toHaveAttribute('aria-pressed', 'false')
  await expect
    .poll(() => Math.round(image.element().getBoundingClientRect().width))
    .toBe(Math.round(fitted))
})

it('inverts the scans from the toolbar', async () => {
  await mount('/catalog/t1')
  await thumbnail(0).click()
  const invert = viewer().getByRole('button', { name: INVERT })
  await invert.click()
  await expect.element(invert).toHaveAttribute('aria-pressed', 'true')
  await expect.element(viewer().getByRole('img', { name: scanName(0) })).toHaveClass('invert')
  await invert.click()
  await expect.element(invert).toHaveAttribute('aria-pressed', 'false')
})

it('keeps the scans inverted when the viewer opens again', async () => {
  await mount('/catalog/t1')
  await thumbnail(0).click()
  await viewer().getByRole('button', { name: INVERT }).click()
  await expect
    .element(viewer().getByRole('button', { name: INVERT }))
    .toHaveAttribute('aria-pressed', 'true')
  await userEvent.keyboard('{Escape}')
  await expect.element(viewer()).not.toBeInTheDocument()
  await thumbnail(0).click()
  await expect
    .element(viewer().getByRole('button', { name: INVERT }))
    .toHaveAttribute('aria-pressed', 'true')
})

it('closes on Escape and from Close, handing focus back to the thumbnail', async () => {
  await mount('/catalog/t1')
  await thumbnail(1).click()
  await expect.element(viewer()).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(viewer()).not.toBeInTheDocument()
  await expect.element(thumbnail(1)).toHaveFocus()
  await thumbnail(2).click()
  await viewer().getByRole('button', { name: CLOSE, exact: true }).click()
  await expect.element(viewer()).not.toBeInTheDocument()
  await expect.element(thumbnail(2)).toHaveFocus()
})

it('reorders scans in edit mode from the keyboard, and the thumbnails follow', async () => {
  const { db } = await mount('/catalog/t1', WIDE, 'pointer')
  await expect.poll(thumbnailOrder).toEqual(['p0', 'p1', 'p2'])
  await scansSection().getByRole('button', { name: EDIT_SCANS }).click()
  const rows = scansSection().getByRole('grid', { name: SCANS })
  const first = rows.getByRole('row', { name: new RegExp(`^${scanName(0)}`) })
  await expect.element(first).toBeVisible()
  await first.click()
  await expect.element(first).toHaveFocus()
  await userEvent.keyboard('{Shift>}{F10}{/Shift}')
  await page.getByRole('menuitem', { name: MOVE_DOWN }).click()
  await expect
    .poll(async () => sortScans(await db.scans.toArray()).map((scan) => scan.id))
    .toEqual(['p1', 'p0', 'p2'])
  await expect
    .element(page.getByRole('status').filter({ hasText: scanMovedAnnouncement(0, 1, 3) }))
    .toBeInTheDocument()
  await scansSection().getByRole('button', { name: DONE_EDITING_SCANS }).click()
  await expect.poll(thumbnailOrder).toEqual(['p1', 'p0', 'p2'])
})

it('reorders scans in edit mode by dragging from the keyboard', async () => {
  const { db } = await mount('/catalog/t1', WIDE, 'pointer')
  await scansSection().getByRole('button', { name: EDIT_SCANS }).click()
  const rows = scansSection().getByRole('grid', { name: SCANS })
  const first = rows.getByRole('row', { name: new RegExp(`^${scanName(0)}`) })
  await expect.element(first).toBeVisible()
  ;(first.element() as HTMLElement).focus()
  await expect.element(first).toHaveFocus()
  await userEvent.keyboard('{ArrowRight}')
  await expect
    .element(rows.getByRole('button', { name: moveScanName(0), exact: true }))
    .toHaveFocus()
  // Each key waits for the drag to take the one before it, as a person's keys would.
  const dropTarget = () => document.activeElement?.getAttribute('aria-label')
  await userEvent.keyboard('{Enter}')
  await expect.poll(dropTarget).toMatch(/^Insert /)
  const between = `Insert between ${scanName(1)} and ${scanName(2)}`
  for (let step = 0; step < 4 && dropTarget() !== between; step++) {
    const before = dropTarget()
    await userEvent.keyboard('{ArrowDown}')
    await expect.poll(dropTarget).not.toBe(before)
  }
  expect(dropTarget()).toBe(between)
  await userEvent.keyboard('{Enter}')
  await expect
    .poll(async () => sortScans(await db.scans.toArray()).map((scan) => scan.id))
    .toEqual(['p1', 'p0', 'p2'])
  await expect
    .element(page.getByRole('status').filter({ hasText: scanMovedAnnouncement(0, 1, 3) }))
    .toBeInTheDocument()
})

it("opens a catalog row's scans from its Scans action, and only on a tune with scans", async () => {
  await mount('/catalog', WIDE, 'pointer')
  const grid = page.getByRole('grid', { name: TUNE_LIST })
  const row = grid.getByRole('row', { name: new RegExp(`^${TITLE}`) })
  await userEvent.hover(row)
  await row.getByRole('button', { name: SCANS, exact: true }).click()
  await expect.element(viewer()).toBeVisible()
  await expect.element(viewer().getByText(scanCount(0, 3), { exact: true })).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(viewer()).not.toBeInTheDocument()
  const bare = grid.getByRole('row', { name: /^Cluck Old Hen/ })
  await expect.element(bare.getByRole('button', { name: EDIT_TUNE })).toBeInTheDocument()
  expect(bare.getByRole('button', { name: SCANS, exact: true }).elements()).toHaveLength(0)
})

it("opens a list row's scans from its Scans action", async () => {
  const db = openTestDb()
  await seed(db)
  const list: LocalList = {
    id: 'l1',
    created_at: AT,
    updated_at: AT,
    deleted_at: null,
    server_seq: 0,
    name: 'Thursday jam',
    position: 0,
  }
  const item: LocalListItem = {
    id: 'l1-t1',
    created_at: AT,
    updated_at: AT,
    deleted_at: null,
    server_seq: 0,
    list_id: 'l1',
    user_tune_id: 'u-t1',
    position: 0,
  }
  await db.lists.put(list)
  await db.list_items.put(item)
  await renderApp({ path: '/lists/l1', db, frame: WIDE, density: 'pointer' })
  const row = page.getByRole('grid', { name: TUNE_LIST }).getByRole('row', { name: /Soldier/ })
  await userEvent.hover(row)
  await row.getByRole('button', { name: SCANS, exact: true }).click()
  await expect.element(viewer()).toBeVisible()
})

it('hands focus back to the Scans control on pointer once a row-opened viewer closes', async () => {
  await mount('/catalog', WIDE, 'pointer')
  const row = page.getByRole('grid', { name: TUNE_LIST }).getByRole('row', {
    name: new RegExp(`^${TITLE}`),
  })
  await userEvent.hover(row)
  const scans = row.getByRole('button', { name: SCANS, exact: true })
  await scans.click()
  await expect.element(viewer()).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(viewer()).not.toBeInTheDocument()
  await expect.element(scans).toHaveFocus()
  // The list's arrows still work from the restored control.
  await userEvent.keyboard('{ArrowDown}')
  await expect
    .element(page.getByRole('grid', { name: TUNE_LIST }).getByRole('row', { name: /^Turkey/ }))
    .toHaveFocus()
})

it("hands focus to the row once a row-opened viewer's last scan is gone", async () => {
  const { db } = await mount('/catalog', WIDE, 'pointer')
  const row = page.getByRole('grid', { name: TUNE_LIST }).getByRole('row', {
    name: new RegExp(`^${TITLE}`),
  })
  await userEvent.hover(row)
  await row.getByRole('button', { name: SCANS, exact: true }).click()
  await expect.element(viewer()).toBeVisible()
  for (const id of ['p0', 'p1', 'p2']) await deleteScan(db, id)
  await expect.element(viewer()).not.toBeInTheDocument()
  await expect.element(row).toHaveFocus()
  expect(row.getByRole('button', { name: SCANS, exact: true }).elements()).toHaveLength(0)
})

it('hands focus back to the Scans action on touch, leaving the row closed', async () => {
  const { router } = await mount('/catalog', PHONE, 'touch')
  const name = new RegExp(`^${TITLE}`)
  const row = page.getByRole('grid', { name: TUNE_LIST }).getByRole('row', { name })
  const scans = row.getByRole('button', { name: SCANS, exact: true })
  // The row gains Scans once the screen has read which tunes have scans.
  await expect.element(scans).toBeInTheDocument()
  // Held once found: the row leaves the accessibility tree while the viewer covers it.
  const tray = row.element().querySelector<HTMLElement>('[data-swipe]')!
  const swipe = () => tray.dataset.swipe
  // React Aria reports a touch press 80ms after its lift when no click follows, so the swipe's
  // report and the tap's both run on this clock, in the order a phone can produce them: the
  // finger lands on Scans, the swipe's report arrives and is refused, then the finger lifts
  // and the action's own report runs. The viewer's motion and the polls after need real
  // timers back.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    // Past half of the three actions' width, so the release settles open.
    await swipeLeft(row, 200)
    await expect.poll(swipe).toBe('open')
    // The tray settles under the finger before a tap can land on it.
    await expect
      .poll(() => {
        const box = scans.element().getBoundingClientRect()
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
        return hit !== null && scans.element().contains(hit)
      })
      .toBe(true)
    await tap(scans, { beforeLift: () => void vi.advanceTimersByTime(80) })
    vi.advanceTimersByTime(80)
  } finally {
    vi.useRealTimers()
  }
  await expect.element(viewer()).toBeVisible()
  await expect.poll(swipe).toBe('closed')
  // Every state the row takes from here on.
  const seen: string[] = []
  const observer = new MutationObserver(() => seen.push(tray.dataset.swipe ?? ''))
  observer.observe(tray, { attributes: true, attributeFilter: ['data-swipe'] })
  onTestFinished(() => observer.disconnect())
  // A real press, as a phone's tap ends in a click. A bare pointer down and up leaves React
  // Aria to click for it, which it reads as assistive technology.
  await viewer().getByRole('button', { name: CLOSE, exact: true }).click()
  await expect.element(viewer()).not.toBeInTheDocument()
  await expect.element(scans).toHaveFocus()
  // The row decides as focus arrives, so by now it has.
  expect(seen).toEqual([])
  // The tap on the action never pressed the row too.
  expect(router.state.location.pathname).toBe('/catalog')
})
