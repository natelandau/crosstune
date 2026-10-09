import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { recordingAnalytics } from '../../usage/testing'
import { sortScans } from '../../db/scans'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { jpegBlob, scanFile, scanRow } from '../../test/rows'
import { MOVE_TO_BOTTOM } from '../../ui/moveMenu'
import { scanMovedAnnouncement } from './scanCopy'
import { useScansEditor } from './useScansEditor'

let db: CrosstuneDb

beforeEach(async () => {
  db = openTestDb()
  for (let index = 0; index < 3; index++) {
    await db.scans.put(scanRow(`p${index}`, 't1', { position: index }))
    await db.scan_files.put(scanFile(`p${index}`, await jpegBlob(60, 80)))
  }
})

function setup(confirm = vi.fn(async () => true), analytics = recordingAnalytics()) {
  const hook = renderHook(() => useScansEditor('t1', { confirm }), {
    wrapper: dataProviders({ db, analytics }),
  })
  return { ...hook, analytics }
}

const storedOrder = async () =>
  sortScans(
    (await db.scans.where('tune_id').equals('t1').toArray()).filter((row) => !row.deleted_at),
  ).map((row) => row.id)

it('moving a scan writes the order and announces it', async () => {
  const { result } = setup()
  await expect.poll(() => result.current.scans.length).toBe(3)
  act(() => result.current.move(0, 2))
  await expect.poll(() => result.current.scans.map((scan) => scan.id)).toEqual(['p1', 'p2', 'p0'])
  await expect.poll(() => result.current.announcement).toBe(scanMovedAnnouncement(0, 2, 3))
  await expect.poll(storedOrder).toEqual(['p1', 'p2', 'p0'])
})

it("a scan's move menu acts on the rows on screen when pressed", async () => {
  const { result } = setup()
  await expect.poll(() => result.current.scans.length).toBe(3)
  const scan = result.current.scans[0]!
  const toBottom = result.current.moveItems(scan, 0).find((item) => item.label === MOVE_TO_BOTTOM)
  act(() => toBottom?.onPress())
  await expect.poll(storedOrder).toEqual(['p1', 'p2', 'p0'])
  await expect.poll(() => result.current.announcement).toBe(scanMovedAnnouncement(0, 2, 3))
})

it('deletes a scan once the musician confirms', async () => {
  const confirm = vi.fn(async () => true)
  const { result } = setup(confirm)
  await expect.poll(() => result.current.scans.length).toBe(3)
  act(() => result.current.remove(result.current.scans[1]!))
  await expect.poll(() => result.current.scans.map((scan) => scan.id)).toEqual(['p0', 'p2'])
  expect(confirm).toHaveBeenCalledTimes(1)
})

it('reports scan_deleted once the musician confirms, and not when they decline', async () => {
  const confirm = vi.fn(async () => false)
  const { result, analytics } = setup(confirm)
  await expect.poll(() => result.current.scans.length).toBe(3)
  act(() => result.current.remove(result.current.scans[1]!))
  await expect.poll(() => confirm.mock.calls.length).toBe(1)
  confirm.mockResolvedValue(true)
  act(() => result.current.remove(result.current.scans[1]!))
  await expect.poll(() => result.current.scans.map((scan) => scan.id)).toEqual(['p0', 'p2'])
  await expect.poll(() => analytics.sends()).toHaveLength(1)
  expect(analytics.sends()).toEqual([
    { name: 'scan_deleted', props: { scan_id: 'p1', tune_id: 't1' } },
  ])
})

it('reports scans_reordered after each move lands', async () => {
  const { result, analytics } = setup()
  await expect.poll(() => result.current.scans.length).toBe(3)
  act(() => result.current.move(0, 2))
  await expect.poll(storedOrder).toEqual(['p1', 'p2', 'p0'])
  await expect.poll(() => analytics.sends()).toHaveLength(1)
  const scan = result.current.scans[0]!
  const toBottom = result.current.moveItems(scan, 0).find((item) => item.label === MOVE_TO_BOTTOM)
  act(() => toBottom?.onPress())
  await expect.poll(storedOrder).toEqual(['p2', 'p0', 'p1'])
  await expect.poll(() => analytics.sends()).toHaveLength(2)
  expect(analytics.sends()).toEqual(
    Array.from({ length: 2 }, () => ({ name: 'scans_reordered', props: { tune_id: 't1' } })),
  )
})
