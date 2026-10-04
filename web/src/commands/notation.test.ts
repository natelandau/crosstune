import { beforeEach, describe, expect, it } from 'vitest'
import { pendingFor } from '../db/outbox'
import { sortPages } from '../db/notation'
import type { CrosstuneDb } from '../db/schema'
import { openTestDb } from '../test/db'
import {
  addNotationPages,
  deleteNotationPage,
  moveNotationPage,
  NotationPageLimitError,
} from './notation'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

const TUNE = '018f0000-0000-7000-8000-000000000001'
const OTHER_TUNE = '018f0000-0000-7000-8000-000000000002'

function pages(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    blob: new Blob([`page-${index}`]),
    width: 800,
    height: 1200,
  }))
}

async function order(tuneId = TUNE): Promise<string[]> {
  const rows = await db.notation_pages.where('tune_id').equals(tuneId).toArray()
  return sortPages(rows.filter((row) => !row.deleted_at)).map((row) => row.id)
}

describe('notation page commands', () => {
  it('adds pages after existing ones in order', async () => {
    const first = await addNotationPages(db, TUNE, pages(2))
    const second = await addNotationPages(db, TUNE, pages(1))
    expect(await order()).toEqual([...first, ...second])
    const rows = await db.notation_pages.toArray()
    expect(rows.map((row) => row.position).sort((a, b) => a - b)).toEqual([0, 1, 2])
    expect(rows[0]).toMatchObject({ state: 'pending_upload', file_bytes: null, width: 800 })
    const file = await db.notation_files.get(first[0]!)
    expect(file).toMatchObject({ origin: 'captured', error: null, upload_attempts: 0 })
    expect(await pendingFor(db, 'notation_pages', first[0]!)).toMatchObject({ op: 'upsert' })
  })

  it('refuses a 21st live page and writes nothing', async () => {
    await addNotationPages(db, TUNE, pages(19))
    await expect(addNotationPages(db, TUNE, pages(2))).rejects.toThrow(NotationPageLimitError)
    expect(await db.notation_pages.count()).toBe(19)
    expect(await db.notation_files.count()).toBe(19)
    expect(await db.outbox.count()).toBe(19)
    await addNotationPages(db, TUNE, pages(1))
    expect(await db.notation_pages.count()).toBe(20)
  })

  it('frees room under the cap when a page is deleted', async () => {
    const [first] = await addNotationPages(db, TUNE, pages(20))
    await expect(addNotationPages(db, TUNE, pages(1))).rejects.toThrow(NotationPageLimitError)
    await deleteNotationPage(db, first!)
    await addNotationPages(db, TUNE, pages(1))
    expect(await order()).toHaveLength(20)
  })

  it("counts only the tune's own pages toward the cap", async () => {
    await addNotationPages(db, OTHER_TUNE, pages(20))
    await addNotationPages(db, TUNE, pages(20))
    expect(await order()).toHaveLength(20)
    expect(await order(OTHER_TUNE)).toHaveLength(20)
  })

  it('moves a page beside another and renumbers', async () => {
    const [a, b, c] = await addNotationPages(db, TUNE, pages(3))
    await moveNotationPage(db, c!, a!)
    expect(await order()).toEqual([c, a, b])
    expect(
      (await db.notation_pages.toArray()).map((row) => row.position).sort((a, b) => a - b),
    ).toEqual([0, 1, 2])
    await moveNotationPage(db, c!, b!)
    expect(await order()).toEqual([a, b, c])
  })

  it("leaves another tune's pages alone on a move", async () => {
    const [a, b] = await addNotationPages(db, TUNE, pages(2))
    const others = await addNotationPages(db, OTHER_TUNE, pages(2))
    const before = await db.notation_pages.bulkGet(others)
    await moveNotationPage(db, b!, a!)
    expect(await order()).toEqual([b, a])
    expect(await db.notation_pages.bulkGet(others)).toEqual(before)
  })

  it('delete queues a tombstone and keeps the file until the transfer pass drops it', async () => {
    const [a, b] = await addNotationPages(db, TUNE, pages(2))
    await deleteNotationPage(db, a!)
    expect((await db.notation_pages.get(a!))?.deleted_at).not.toBeNull()
    expect(await pendingFor(db, 'notation_pages', a!)).toMatchObject({ op: 'delete' })
    expect(await db.notation_files.get(a!)).toBeDefined()
    expect(await order()).toEqual([b])
  })

  it('sorts pages by position then id', () => {
    const sorted = sortPages([
      { id: 'b', position: 1 },
      { id: 'z', position: 0 },
      { id: 'a', position: 1 },
    ])
    expect(sorted.map((page) => page.id)).toEqual(['z', 'a', 'b'])
  })
})
