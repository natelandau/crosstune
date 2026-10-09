import * as Sentry from '@sentry/react'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { recordingAnalytics } from '../../usage/testing'
import { recordEvent } from '../../commands/events'
import type { CrosstuneDb } from '../../db/schema'
import { useWakeLock } from '../../platform/wakeLock'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { jpegBlob, scanFile, scanRow } from '../../test/rows'
import { SCAN_VIEW_THRESHOLD_MS } from './scanViewLog'
import { DOUBLE_TAP_MS, useScanViewer } from './useScanViewer'

vi.mock('@sentry/react', { spy: true })
vi.mock('../../commands/events', { spy: true })
vi.mock('../../platform/wakeLock', () => ({ useWakeLock: vi.fn() }))

let db: CrosstuneDb

beforeEach(() => {
  vi.mocked(useWakeLock).mockClear()
  vi.mocked(Sentry.captureMessage).mockClear()
  vi.mocked(recordEvent).mockClear()
  db = openTestDb()
})

async function addScans(count: number) {
  for (let index = 0; index < count; index++) {
    await db.scans.put(scanRow(`p${index}`, 't1', { position: index }))
    await db.scan_files.put(scanFile(`p${index}`, await jpegBlob(60, 80)))
  }
}

function setup({
  now = () => 0,
  onClose = vi.fn(),
  confirm = vi.fn(async () => true),
  analytics = recordingAnalytics(),
}: {
  now?: () => number
  onClose?: () => void
  confirm?: () => Promise<boolean>
  analytics?: ReturnType<typeof recordingAnalytics>
} = {}) {
  return renderHook(
    () =>
      useScanViewer({
        tuneId: 't1',
        startIndex: 0,
        origin: { context: 'tune' },
        now,
        confirm,
        onClose,
      }),
    { wrapper: dataProviders({ db, analytics }) },
  )
}

const tap = (x = 10, y = 10) => ({ clientX: x, clientY: y })

it('closes itself when its last scan is deleted', async () => {
  await addScans(1)
  const onClose = vi.fn()
  const { result } = setup({ onClose })
  await expect.poll(() => result.current.count).toBe(1)
  expect(onClose).not.toHaveBeenCalled()
  act(() => result.current.remove())
  await expect.poll(() => onClose.mock.calls.length).toBe(1)
})

it('two taps within the double-tap window toggle zoom', async () => {
  await addScans(2)
  let t = 1_000
  const { result } = setup({ now: () => t })
  await expect.poll(() => result.current.ready).toBe(true)
  expect(result.current.isDoubleTap(tap())).toBe(false)
  t += DOUBLE_TAP_MS - 1
  const second = result.current.isDoubleTap(tap(12, 12))
  expect(second).toBe(true)
  act(() => {
    if (second) result.current.toggleZoom()
  })
  await expect.poll(() => result.current.zoom).toBe(2)
  // A third tap starts a new pair rather than finishing the last one.
  t += 10
  expect(result.current.isDoubleTap(tap())).toBe(false)
  t += DOUBLE_TAP_MS
  expect(result.current.isDoubleTap(tap())).toBe(false)
  act(() => result.current.toggleZoom())
  await expect.poll(() => result.current.zoom).toBe('fit')
})

it('reads taps far apart in space as two taps', async () => {
  await addScans(1)
  const t = 1_000
  const { result } = setup({ now: () => t })
  await expect.poll(() => result.current.ready).toBe(true)
  expect(result.current.isDoubleTap(tap(0, 0))).toBe(false)
  expect(result.current.isDoubleTap(tap(200, 0))).toBe(false)
})

it('reports a broken scan once', async () => {
  await addScans(1)
  const { result } = setup()
  await expect.poll(() => result.current.ready).toBe(true)
  act(() => result.current.reportBroken('p0'))
  act(() => result.current.reportBroken('p0'))
  await expect.poll(() => vi.mocked(Sentry.captureMessage).mock.calls.length).toBe(1)
  expect(vi.mocked(Sentry.captureMessage).mock.calls[0]?.[1]).toEqual(
    expect.objectContaining({ extra: { scanId: 'p0' } }),
  )
})

it('holds a wake lock while mounted', async () => {
  await addScans(1)
  setup()
  await expect.poll(() => vi.mocked(useWakeLock).mock.calls.at(-1)?.[0]).toBe(true)
})

const views = () => db.scan_views.toArray()

it('ends the view once on close', async () => {
  await addScans(1)
  let t = 1_000
  const { result, unmount } = setup({ now: () => t })
  await expect.poll(() => result.current.count).toBe(1)
  t += SCAN_VIEW_THRESHOLD_MS
  act(() => result.current.close())
  await expect.poll(views).toEqual([expect.objectContaining({ viewed_ms: SCAN_VIEW_THRESHOLD_MS })])
  t += SCAN_VIEW_THRESHOLD_MS
  unmount()
  expect(await views()).toHaveLength(1)
})

it('starts a view when scans arrive after the tune had none', async () => {
  let t = 1_000
  const { result } = setup({ now: () => t })
  await expect.poll(() => result.current.ready).toBe(true)
  expect(result.current.count).toBe(0)
  t += 10_000
  await addScans(1)
  await expect.poll(() => result.current.count).toBe(1)
  t += SCAN_VIEW_THRESHOLD_MS
  act(() => result.current.close())
  await expect.poll(views).toEqual([expect.objectContaining({ viewed_ms: SCAN_VIEW_THRESHOLD_MS })])
})

const VIEWED = { name: 'scan_viewed', props: { tune_id: 't1' } }

it('reports scan_viewed once per opening, before the view meets the threshold', async () => {
  await addScans(3)
  const analytics = recordingAnalytics()
  const t = 1_000
  const { result } = setup({ now: () => t, analytics })
  await expect.poll(() => analytics.sends()).toEqual([VIEWED])
  act(() => result.current.setIndex(2))
  await expect.poll(() => result.current.index).toBe(2)
  act(() => result.current.close())
  expect(analytics.sends()).toEqual([VIEWED])
  expect(await views()).toEqual([])
})

it('reports scan_viewed when scans arrive after the viewer opened on none', async () => {
  const analytics = recordingAnalytics()
  const { result } = setup({ analytics })
  await expect.poll(() => result.current.ready).toBe(true)
  expect(analytics.sends()).toEqual([])
  await addScans(1)
  await expect.poll(() => analytics.sends()).toEqual([VIEWED])
  await addScans(2)
  await expect.poll(() => result.current.count).toBe(2)
  expect(analytics.sends()).toEqual([VIEWED])
})
