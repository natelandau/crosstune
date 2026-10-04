import { beforeEach, describe, expect, it } from 'vitest'
import { pendingFor } from '../db/outbox'
import { sortScans } from '../db/scans'
import type { CrosstuneDb } from '../db/schema'
import { openTestDb } from '../test/db'
import { addScans, deleteScan, moveScan, ScanLimitError } from './scans'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

const TUNE = '018f0000-0000-7000-8000-000000000001'
const OTHER_TUNE = '018f0000-0000-7000-8000-000000000002'

function scans(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    blob: new Blob([`scan-${index}`]),
    width: 800,
    height: 1200,
  }))
}

async function order(tuneId = TUNE): Promise<string[]> {
  const rows = await db.scans.where('tune_id').equals(tuneId).toArray()
  return sortScans(rows.filter((row) => !row.deleted_at)).map((row) => row.id)
}

describe('scan commands', () => {
  it('adds scans after existing ones in order', async () => {
    const first = await addScans(db, TUNE, scans(2))
    const second = await addScans(db, TUNE, scans(1))
    expect(await order()).toEqual([...first, ...second])
    const rows = await db.scans.toArray()
    expect(rows.map((row) => row.position).sort((a, b) => a - b)).toEqual([0, 1, 2])
    expect(rows[0]).toMatchObject({ state: 'pending_upload', file_bytes: null, width: 800 })
    const file = await db.scan_files.get(first[0]!)
    expect(file).toMatchObject({ origin: 'captured', error: null, upload_attempts: 0 })
    expect(await pendingFor(db, 'scans', first[0]!)).toMatchObject({ op: 'upsert' })
  })

  it('refuses a 21st live scan and writes nothing', async () => {
    await addScans(db, TUNE, scans(19))
    await expect(addScans(db, TUNE, scans(2))).rejects.toThrow(ScanLimitError)
    expect(await db.scans.count()).toBe(19)
    expect(await db.scan_files.count()).toBe(19)
    expect(await db.outbox.count()).toBe(19)
    await addScans(db, TUNE, scans(1))
    expect(await db.scans.count()).toBe(20)
  })

  it('frees room under the cap when a scan is deleted', async () => {
    const [first] = await addScans(db, TUNE, scans(20))
    await expect(addScans(db, TUNE, scans(1))).rejects.toThrow(ScanLimitError)
    await deleteScan(db, first!)
    await addScans(db, TUNE, scans(1))
    expect(await order()).toHaveLength(20)
  })

  it("counts only the tune's own scans toward the cap", async () => {
    await addScans(db, OTHER_TUNE, scans(20))
    await addScans(db, TUNE, scans(20))
    expect(await order()).toHaveLength(20)
    expect(await order(OTHER_TUNE)).toHaveLength(20)
  })

  it('moves a scan beside another and renumbers', async () => {
    const [a, b, c] = await addScans(db, TUNE, scans(3))
    await moveScan(db, c!, a!)
    expect(await order()).toEqual([c, a, b])
    expect((await db.scans.toArray()).map((row) => row.position).sort((a, b) => a - b)).toEqual([
      0, 1, 2,
    ])
    await moveScan(db, c!, b!)
    expect(await order()).toEqual([a, b, c])
  })

  it("leaves another tune's scans alone on a move", async () => {
    const [a, b] = await addScans(db, TUNE, scans(2))
    const others = await addScans(db, OTHER_TUNE, scans(2))
    const before = await db.scans.bulkGet(others)
    await moveScan(db, b!, a!)
    expect(await order()).toEqual([b, a])
    expect(await db.scans.bulkGet(others)).toEqual(before)
  })

  it('delete queues a tombstone and keeps the file until the transfer pass drops it', async () => {
    const [a, b] = await addScans(db, TUNE, scans(2))
    await deleteScan(db, a!)
    expect((await db.scans.get(a!))?.deleted_at).not.toBeNull()
    expect(await pendingFor(db, 'scans', a!)).toMatchObject({ op: 'delete' })
    expect(await db.scan_files.get(a!)).toBeDefined()
    expect(await order()).toEqual([b])
  })

  it('sorts scans by position then id', () => {
    const sorted = sortScans([
      { id: 'b', position: 1 },
      { id: 'z', position: 0 },
      { id: 'a', position: 1 },
    ])
    expect(sorted.map((scan) => scan.id)).toEqual(['z', 'a', 'b'])
  })
})
