import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pendingBatch, pendingFor } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { openTestDb } from '../test/db'
import {
  activeItems,
  addToList,
  createList,
  deleteList,
  moveItem,
  removeFromList,
  renameList,
} from './lists'
import { createSong } from './songs'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

async function threeSongs() {
  const a = (await createSong(db, { title: 'A' }, { status: 'known' })).userSongId
  const b = (await createSong(db, { title: 'B' }, { status: 'known' })).userSongId
  const c = (await createSong(db, { title: 'C' }, { status: 'known' })).userSongId
  return [a, b, c] as const
}

describe('lists', () => {
  it('creates lists in position order and renames them', async () => {
    const first = await createList(db, 'Tuesday jam')
    const second = await createList(db, 'Square dance')
    expect((await db.lists.get(first))?.position).toBe(0)
    expect((await db.lists.get(second))?.position).toBe(1)
    await renameList(db, first, 'Thursday jam')
    expect((await db.lists.get(first))?.name).toBe('Thursday jam')
    expect(await pendingFor(db, 'lists', first)).toMatchObject({ op: 'upsert' })
  })

  it('adds items once, in order, and removes them', async () => {
    const [a, b] = await threeSongs()
    const listId = await createList(db, 'L')
    const itemA = await addToList(db, listId, a)
    const itemB = await addToList(db, listId, b)
    expect(await addToList(db, listId, a)).toBe(itemA)
    expect((await activeItems(db, listId)).map((i) => i.id)).toEqual([itemA, itemB])
    await removeFromList(db, itemA)
    expect((await activeItems(db, listId)).map((i) => i.id)).toEqual([itemB])
    expect((await pendingFor(db, 'list_items', itemA))?.op).toBe('delete')
  })

  it('moves an item by rewriting only the positions that changed', async () => {
    const [a, b, c] = await threeSongs()
    const listId = await createList(db, 'L')
    const ia = await addToList(db, listId, a)
    const ib = await addToList(db, listId, b)
    const ic = await addToList(db, listId, c)
    const untouched = (await pendingFor(db, 'list_items', ia))!.updated_at
    await moveItem(db, listId, ic, -1)
    expect((await activeItems(db, listId)).map((i) => i.id)).toEqual([ia, ic, ib])
    expect((await activeItems(db, listId)).map((i) => i.position)).toEqual([0, 1, 2])
    expect((await pendingFor(db, 'list_items', ia))!.updated_at).toBe(untouched)
  })

  it('trims a new list name and refuses an empty one', async () => {
    const listId = await createList(db, '  Tuesday jam  ')
    expect((await db.lists.get(listId))?.name).toBe('Tuesday jam')
    await expect(createList(db, '   ')).rejects.toThrow('A list needs a name')
  })

  it('moves an item nowhere at either end of the list', async () => {
    const [a, b, c] = await threeSongs()
    const listId = await createList(db, 'L')
    const ia = await addToList(db, listId, a)
    const ib = await addToList(db, listId, b)
    const ic = await addToList(db, listId, c)
    await moveItem(db, listId, ia, -1)
    expect((await activeItems(db, listId)).map((i) => i.id)).toEqual([ia, ib, ic])
    await moveItem(db, listId, ic, 1)
    expect((await activeItems(db, listId)).map((i) => i.id)).toEqual([ia, ib, ic])
    await moveItem(db, listId, ic, -1)
    expect((await activeItems(db, listId)).map((i) => i.id)).toEqual([ia, ic, ib])
  })

  it('deletes a list and tombstones its items without queuing them', async () => {
    const [a] = await threeSongs()
    const listId = await createList(db, 'L')
    const item = await addToList(db, listId, a)
    await deleteList(db, listId)
    expect((await db.lists.get(listId))?.deleted_at).not.toBeNull()
    expect((await db.list_items.get(item))?.deleted_at).not.toBeNull()
    const ops = (await pendingBatch(db)).filter(
      (e) => e.table !== 'songs' && e.table !== 'user_songs',
    )
    expect(ops.map((e) => [e.table, e.op])).toEqual([['lists', 'delete']])
  })

  it('gives a new item a position past a removed item, with no collisions', async () => {
    const [a, b, c] = await threeSongs()
    const listId = await createList(db, 'L')
    const itemA = await addToList(db, listId, a)
    await addToList(db, listId, b)
    await removeFromList(db, itemA)
    const itemC = await addToList(db, listId, c)
    const active = await activeItems(db, listId)
    const positions = active.map((i) => i.position)
    expect(new Set(positions).size).toBe(positions.length)
    const newItem = active.find((i) => i.id === itemC)!
    for (const item of active) {
      if (item.id !== itemC) expect(newItem.position).toBeGreaterThan(item.position)
    }
  })
})
