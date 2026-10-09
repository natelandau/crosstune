import { beforeEach, describe, expect, it } from 'vitest'
import { pendingFor } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { openTestDb } from '../test/db'
import { importTunes } from './importTunes'
import { activeItems, addToList, createList } from './lists'
import { LIST_NAME_REQUIRED, LIST_NOT_FOUND, NOTHING_TO_IMPORT } from './messages'
import { createTune } from './tunes'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

describe('importTunes', () => {
  it('creates a tune and user-tune per title with the batch status and genre', async () => {
    const result = await importTunes(db, {
      titles: ['Soldier’s Joy', 'Cluck Old Hen'],
      status: 'known',
      genre: 'Old-time',
      list: { kind: 'none' },
    })
    expect(result.userTuneIds).toHaveLength(2)
    expect(result.listId).toBeNull()
    expect(result.listCreated).toBe(false)
    const tunes = await db.tunes.toArray()
    expect(tunes.map((tune) => tune.genre)).toEqual(['Old-time', 'Old-time'])
    const userTunes = await db.user_tunes.toArray()
    expect(userTunes.map((userTune) => userTune.status)).toEqual(['known', 'known'])
    for (const tune of tunes) expect(await pendingFor(db, 'tunes', tune.id)).toBeDefined()
    for (const userTune of userTunes) {
      expect(await pendingFor(db, 'user_tunes', userTune.id)).toBeDefined()
    }
  })

  it('adds to a new list in order', async () => {
    const titles = ['One', 'Two', 'Three']
    const result = await importTunes(db, {
      titles,
      status: 'want_to_learn',
      genre: null,
      list: { kind: 'new', name: 'Imported 2026-10-09' },
    })
    expect(result.listCreated).toBe(true)
    const lists = await db.lists.toArray()
    expect(lists).toHaveLength(1)
    expect(lists[0]?.name).toBe('Imported 2026-10-09')
    expect(result.listId).toBe(lists[0]?.id)
    const items = (await activeItems(db, lists[0]?.id ?? '')).toSorted(
      (a, b) => a.position - b.position,
    )
    expect(items.map((item) => item.user_tune_id)).toEqual(result.userTuneIds)
    const created = await Promise.all(
      result.userTuneIds.map(async (id) => {
        const userTune = await db.user_tunes.get(id)
        return (await db.tunes.get(userTune?.tune_id ?? ''))?.title
      }),
    )
    expect(created).toEqual(titles)
    expect(await pendingFor(db, 'lists', result.listId ?? '')).toBeDefined()
    for (const item of items) expect(await pendingFor(db, 'list_items', item.id)).toBeDefined()
  })

  it('adds to an existing list after its items', async () => {
    const listId = await createList(db, 'Jam')
    const first = (await createTune(db, { title: 'Existing' }, { status: 'known' })).userTuneId
    await addToList(db, listId, first)
    const [existing] = await activeItems(db, listId)
    const result = await importTunes(db, {
      titles: ['A', 'B'],
      status: 'want_to_learn',
      genre: null,
      list: { kind: 'existing', listId },
    })
    expect(result.listId).toBe(listId)
    expect(result.listCreated).toBe(false)
    const items = (await activeItems(db, listId)).toSorted((a, b) => a.position - b.position)
    expect(items.map((item) => item.user_tune_id)).toEqual([first, ...result.userTuneIds])
    expect(items[0]).toEqual(existing)
  })

  it('writes nothing when the list is gone', async () => {
    await expect(
      importTunes(db, {
        titles: ['A'],
        status: 'want_to_learn',
        genre: null,
        list: { kind: 'existing', listId: 'missing' },
      }),
    ).rejects.toThrow(LIST_NOT_FOUND)
    expect(await db.tunes.count()).toBe(0)
    expect(await db.user_tunes.count()).toBe(0)
  })

  it('rolls back the tunes when the new list cannot be made', async () => {
    await expect(
      importTunes(db, {
        titles: ['A', 'B'],
        status: 'want_to_learn',
        genre: null,
        list: { kind: 'new', name: '   ' },
      }),
    ).rejects.toThrow(LIST_NAME_REQUIRED)
    expect(await db.tunes.count()).toBe(0)
    expect(await db.user_tunes.count()).toBe(0)
    expect(await db.lists.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
  })

  it('adds nothing when one title is blank', async () => {
    await expect(
      importTunes(db, {
        titles: ['A', '   '],
        status: 'want_to_learn',
        genre: null,
        list: { kind: 'none' },
      }),
    ).rejects.toThrow()
    expect(await db.tunes.count()).toBe(0)
    expect(await db.user_tunes.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
  })

  it('refuses an empty plan', async () => {
    await expect(
      importTunes(db, { titles: [], status: 'want_to_learn', genre: null, list: { kind: 'none' } }),
    ).rejects.toThrow(NOTHING_TO_IMPORT)
  })
})
