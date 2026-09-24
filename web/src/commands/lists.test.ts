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
import { LIST_NAME_REQUIRED, LIST_NOT_FOUND } from './messages'
import { createTune } from './tunes'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

async function threeTunes() {
  const a = (await createTune(db, { title: 'A' }, { status: 'known' })).userTuneId
  const b = (await createTune(db, { title: 'B' }, { status: 'known' })).userTuneId
  const c = (await createTune(db, { title: 'C' }, { status: 'known' })).userTuneId
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
    const [a, b] = await threeTunes()
    const listId = await createList(db, 'L')
    const itemA = await addToList(db, listId, a)
    const itemB = await addToList(db, listId, b)
    expect(await addToList(db, listId, a)).toBe(itemA)
    expect((await activeItems(db, listId)).map((i) => i.id)).toEqual([itemA, itemB])
    await removeFromList(db, itemA)
    expect((await activeItems(db, listId)).map((i) => i.id)).toEqual([itemB])
    expect((await pendingFor(db, 'list_items', itemA))?.op).toBe('delete')
  })

  it('refuses to add a tune to a list that is missing or deleted', async () => {
    const [a] = await threeTunes()
    await expect(addToList(db, 'nope', a)).rejects.toThrow(LIST_NOT_FOUND)
    const listId = await createList(db, 'Gone')
    await deleteList(db, listId)
    await expect(addToList(db, listId, a)).rejects.toThrow(LIST_NOT_FOUND)
    expect(await db.list_items.count()).toBe(0)
  })

  it('moves an item by rewriting only the positions that changed', async () => {
    const [a, b, c] = await threeTunes()
    const listId = await createList(db, 'L')
    const ia = await addToList(db, listId, a)
    const ib = await addToList(db, listId, b)
    const ic = await addToList(db, listId, c)
    const untouched = (await pendingFor(db, 'list_items', ia))!.updated_at
    await moveItem(db, listId, ic, ib)
    expect((await activeItems(db, listId)).map((i) => i.id)).toEqual([ia, ic, ib])
    expect((await activeItems(db, listId)).map((i) => i.position)).toEqual([0, 1, 2])
    expect((await pendingFor(db, 'list_items', ia))!.updated_at).toBe(untouched)
  })

  it('trims a new list name and refuses an empty one', async () => {
    const listId = await createList(db, '  Tuesday jam  ')
    expect((await db.lists.get(listId))?.name).toBe('Tuesday jam')
    await expect(createList(db, '   ')).rejects.toThrow(LIST_NAME_REQUIRED)
  })

  it.each([
    ['down past the next item', 'a', 'b', ['b', 'a', 'c']],
    ['up past the previous item', 'c', 'b', ['a', 'c', 'b']],
    ['to the bottom', 'a', 'c', ['b', 'c', 'a']],
    ['to the top', 'c', 'a', ['c', 'a', 'b']],
  ] as const)('moves an item %s', async (_name, moved, target, expected) => {
    const [a, b, c] = await threeTunes()
    const listId = await createList(db, 'L')
    const ids = {
      a: await addToList(db, listId, a),
      b: await addToList(db, listId, b),
      c: await addToList(db, listId, c),
    }
    await moveItem(db, listId, ids[moved], ids[target])
    expect((await activeItems(db, listId)).map((i) => i.id)).toEqual(expected.map((k) => ids[k]))
  })

  it('moves past an item between it and the target, landing beside the target', async () => {
    const [a, b, c] = await threeTunes()
    const listId = await createList(db, 'L')
    const ia = await addToList(db, listId, a)
    const ib = await addToList(db, listId, b)
    const ic = await addToList(db, listId, c)
    await moveItem(db, listId, ia, ic)
    expect((await activeItems(db, listId)).map((i) => i.id)).toEqual([ib, ic, ia])
    await moveItem(db, listId, ia, ib)
    expect((await activeItems(db, listId)).map((i) => i.id)).toEqual([ia, ib, ic])
  })

  it('moves nothing for a missing target or the item itself', async () => {
    const [a, b] = await threeTunes()
    const listId = await createList(db, 'L')
    const ia = await addToList(db, listId, a)
    const ib = await addToList(db, listId, b)
    await moveItem(db, listId, ia, 'missing')
    await moveItem(db, listId, ia, ia)
    await moveItem(db, listId, 'missing', ib)
    expect((await activeItems(db, listId)).map((i) => i.id)).toEqual([ia, ib])
  })

  it('deletes a list and tombstones its items without queuing them', async () => {
    const [a] = await threeTunes()
    const listId = await createList(db, 'L')
    const item = await addToList(db, listId, a)
    await deleteList(db, listId)
    expect((await db.lists.get(listId))?.deleted_at).not.toBeNull()
    expect((await db.list_items.get(item))?.deleted_at).not.toBeNull()
    const ops = (await pendingBatch(db)).filter(
      (e) => e.table !== 'tunes' && e.table !== 'user_tunes',
    )
    expect(ops.map((e) => [e.table, e.op])).toEqual([['lists', 'delete']])
  })

  it('gives a new item a position past a removed item, with no collisions', async () => {
    const [a, b, c] = await threeTunes()
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
