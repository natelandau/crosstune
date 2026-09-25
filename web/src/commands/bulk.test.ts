import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pendingFor } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { openTestDb } from '../test/db'
import { recordingFile, recordingRow } from '../test/rows'
import {
  addTunesToList,
  createListWithTunes,
  deleteTunes,
  removeTunesFromList,
  setArchivedMany,
  updateTunes,
} from './bulk'
import { activeItems, addToList, createList, moveItem, removeFromList } from './lists'
import { LIST_NAME_REQUIRED, LIST_NOT_FOUND, TUNE_NOT_FOUND, TUNE_NOT_IN_LIST } from './messages'
import { createTune, deleteTune, setArchived, updateTune } from './tunes'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

async function tune(title: string, extra: Parameters<typeof createTune>[1] = { title }) {
  return createTune(db, { ...extra, title }, { status: 'learning' })
}

describe('updateTunes', () => {
  it('writes tune and user tune fields on every selected tune', async () => {
    const a = await tune('Say Old Man', { title: '', key: 'A' })
    const b = await tune('Lost Indian', { title: '', key: 'A', genre: 'Old-time' })
    await updateTunes(db, [a.userTuneId, b.userTuneId], {
      tune: { genre: null },
      tunings: { violin: 'Cross A (AEAE)' },
      userTune: { status: 'known' },
    })
    for (const { tuneId, userTuneId } of [a, b]) {
      expect(await db.tunes.get(tuneId)).toMatchObject({
        tunings: { violin: { tuning: 'Cross A (AEAE)' } },
        genre: null,
        key: 'A',
      })
      expect((await db.user_tunes.get(userTuneId))?.status).toBe('known')
    }
  })

  it('writes nothing when one tune is missing', async () => {
    const a = await tune('Say Old Man')
    const b = await tune('Lost Indian')
    await deleteTune(db, b.tuneId)
    await expect(
      updateTunes(db, [a.userTuneId, b.userTuneId], { userTune: { status: 'known' } }),
    ).rejects.toThrow(TUNE_NOT_FOUND)
    expect((await db.user_tunes.get(a.userTuneId))?.status).toBe('learning')
  })

  it('leaves a row alone when it already matches the patch', async () => {
    const a = await tune('Say Old Man', { title: '', key: 'A' })
    await db.outbox.clear()
    const before = await db.tunes.get(a.tuneId)
    await updateTunes(db, [a.userTuneId], { tune: { key: 'A' } })
    expect(await db.tunes.get(a.tuneId)).toEqual(before)
    expect(await pendingFor(db, 'tunes', a.tuneId)).toBeUndefined()
    expect(await pendingFor(db, 'user_tunes', a.userTuneId)).toBeUndefined()
  })

  it('keeps a field the patch leaves undefined', async () => {
    const a = await tune('Say Old Man', { title: '', key: 'A', genre: 'Old-time' })
    await updateTunes(db, [a.userTuneId], { tune: { key: 'D', genre: undefined } })
    expect(await db.tunes.get(a.tuneId)).toMatchObject({ key: 'D', genre: 'Old-time' })
  })

  it('undoes only the fields it changed, keeping an edit made since', async () => {
    const a = await tune('Say Old Man', {
      title: '',
      key: 'A',
      tunings: { violin: { tuning: 'Standard (GDAE)' } },
    })
    const undo = await updateTunes(db, [a.userTuneId], {
      tunings: { violin: 'Cross A (AEAE)' },
      userTune: { status: 'known' },
    })
    await updateTune(db, a.tuneId, { key: 'G' })
    await undo()
    expect(await db.tunes.get(a.tuneId)).toMatchObject({
      tunings: { violin: { tuning: 'Standard (GDAE)' } },
      key: 'G',
    })
    expect((await db.user_tunes.get(a.userTuneId))?.status).toBe('learning')
    expect(await pendingFor(db, 'tunes', a.tuneId)).toMatchObject({ op: 'upsert' })
  })

  it('sets one instrument’s tuning, keeps capos and unknown keys, and undoes the whole map', async () => {
    const tunings = {
      guitar: { tuning: 'DADGAD', capo: 2 },
      violin: { tuning: 'AEAE' },
      hardanger: { tuning: 'x' },
    }
    const a = await tune('Say Old Man', { title: '', tunings })
    const undo = await updateTunes(db, [a.userTuneId], {
      tunings: { guitar: 'Drop D (DADGBE)', violin: null },
    })
    expect((await db.tunes.get(a.tuneId))!.tunings).toEqual({
      guitar: { tuning: 'Drop D (DADGBE)', capo: 2 },
      hardanger: { tuning: 'x' },
    })
    await undo()
    expect((await db.tunes.get(a.tuneId))!.tunings).toEqual(tunings)
  })

  it('leaves a tune alone when its tunings already match', async () => {
    const a = await tune('Say Old Man', { title: '', tunings: { violin: { tuning: 'AEAE' } } })
    await db.outbox.clear()
    await updateTunes(db, [a.userTuneId], { tunings: { violin: 'AEAE' } })
    expect(await pendingFor(db, 'tunes', a.tuneId)).toBeUndefined()
  })

  it('leaves a tune alone when its tunings match in another key order', async () => {
    const tunings = { violin: { tuning: 'AEAE' }, guitar: { capo: 2, tuning: 'DADGAD' } }
    const a = await tune('Say Old Man', { title: '', tunings })
    await db.outbox.clear()
    await updateTunes(db, [a.userTuneId], { tunings: { guitar: 'DADGAD', violin: 'AEAE' } })
    expect(await pendingFor(db, 'tunes', a.tuneId)).toBeUndefined()
    expect((await db.tunes.get(a.tuneId))!.tunings).toEqual(tunings)
  })

  it('leaves a tune whose modes already match untouched', async () => {
    const a = await tune('The Kesh', { title: '', modes: ['dorian'] })
    await db.outbox.clear()
    await updateTunes(db, [a.userTuneId], { tune: { modes: ['dorian'] } })
    expect(await db.outbox.count()).toBe(0)
  })

  it('restores every part mode on undo', async () => {
    const a = await tune('The Kesh', { title: '', modes: ['major', 'mixolydian'] })
    const undo = await updateTunes(db, [a.userTuneId], { tune: { modes: ['dorian'] } })
    expect((await db.tunes.get(a.tuneId))?.modes).toEqual(['dorian'])
    await undo()
    expect((await db.tunes.get(a.tuneId))?.modes).toEqual(['major', 'mixolydian'])
  })

  it('undo gives the restored row a fresh updated_at', async () => {
    const a = await tune('Say Old Man')
    const undo = await updateTunes(db, [a.userTuneId], { tune: { key: 'A' } })
    const changed = (await db.tunes.get(a.tuneId))!.updated_at
    vi.setSystemTime(new Date(Date.parse(changed) + 1000))
    await undo()
    vi.useRealTimers()
    expect(Date.parse((await db.tunes.get(a.tuneId))!.updated_at)).toBeGreaterThan(
      Date.parse(changed),
    )
  })

  it('undo skips a tune deleted since', async () => {
    const a = await tune('Say Old Man')
    const b = await tune('Lost Indian')
    const undo = await updateTunes(db, [a.userTuneId, b.userTuneId], { tune: { key: 'A' } })
    await deleteTune(db, b.tuneId)
    await undo()
    expect((await db.tunes.get(a.tuneId))?.key).toBeNull()
    expect((await db.tunes.get(b.tuneId))?.deleted_at).not.toBeNull()
  })
})

describe('setArchivedMany', () => {
  it('archives the selected tunes and undo restores each one', async () => {
    const a = await tune('Say Old Man')
    const b = await tune('Lost Indian')
    await setArchived(db, b.userTuneId, true)
    const archivedAt = (await db.user_tunes.get(b.userTuneId))!.archived_at
    const undo = await setArchivedMany(db, [a.userTuneId, b.userTuneId], true)
    expect((await db.user_tunes.get(a.userTuneId))?.archived_at).not.toBeNull()
    expect((await db.user_tunes.get(b.userTuneId))?.archived_at).toBe(archivedAt)
    await undo()
    expect((await db.user_tunes.get(a.userTuneId))?.archived_at).toBeNull()
    expect((await db.user_tunes.get(b.userTuneId))?.archived_at).toBe(archivedAt)
  })

  it('unarchives, and undo archives again with the old timestamp', async () => {
    const a = await tune('Say Old Man')
    await setArchived(db, a.userTuneId, true)
    const archivedAt = (await db.user_tunes.get(a.userTuneId))!.archived_at
    const undo = await setArchivedMany(db, [a.userTuneId], false)
    expect((await db.user_tunes.get(a.userTuneId))?.archived_at).toBeNull()
    await undo()
    expect((await db.user_tunes.get(a.userTuneId))?.archived_at).toBe(archivedAt)
  })
})

describe('deleteTunes', () => {
  it('tombstones each selected tune with its user tune, list entries, and recordings', async () => {
    const a = await tune('Say Old Man')
    const b = await tune('Lost Indian')
    const kept = await tune('Ducks on the Millpond')
    const listId = await createList(db, 'Tuesday jam')
    await addToList(db, listId, a.userTuneId)
    await db.recordings.put(recordingRow('r1', { tune_id: a.tuneId }))
    await db.recording_files.put(recordingFile('r1'))

    expect(await deleteTunes(db, [a.userTuneId, b.userTuneId])).toBe(2)
    expect((await db.tunes.get(a.tuneId))?.deleted_at).not.toBeNull()
    expect((await db.user_tunes.get(a.userTuneId))?.deleted_at).not.toBeNull()
    expect((await db.tunes.get(b.tuneId))?.deleted_at).not.toBeNull()
    expect((await db.tunes.get(kept.tuneId))?.deleted_at).toBeNull()
    expect(await activeItems(db, listId)).toEqual([])
    expect((await db.recordings.get('r1'))?.deleted_at).not.toBeNull()
    expect(await db.recording_files.get('r1')).toBeUndefined()
  })

  it('queues one delete per tune and none for the rows that go with it', async () => {
    const a = await tune('Say Old Man')
    await deleteTunes(db, [a.userTuneId])
    expect(await pendingFor(db, 'tunes', a.tuneId)).toMatchObject({ op: 'delete' })
    expect(await pendingFor(db, 'user_tunes', a.userTuneId)).toBeUndefined()
  })

  it('counts two selected user tunes of one tune once', async () => {
    const a = await tune('Say Old Man')
    expect(await deleteTunes(db, [a.userTuneId, a.userTuneId])).toBe(1)
  })

  it('rejects when a selected tune is already gone', async () => {
    const a = await tune('Say Old Man')
    await deleteTune(db, a.tuneId)
    await expect(deleteTunes(db, [a.userTuneId])).rejects.toThrow(TUNE_NOT_FOUND)
  })
})

describe('addTunesToList', () => {
  it('appends missing tunes in the given order and skips members', async () => {
    const a = await tune('A')
    const b = await tune('B')
    const c = await tune('C')
    const listId = await createList(db, 'Tuesday jam')
    await addToList(db, listId, b.userTuneId)
    const { added } = await addTunesToList(db, listId, [c.userTuneId, b.userTuneId, a.userTuneId])
    expect(added).toBe(2)
    expect((await activeItems(db, listId)).map((i) => i.user_tune_id)).toEqual([
      b.userTuneId,
      c.userTuneId,
      a.userTuneId,
    ])
  })

  it('undo removes only the items it added', async () => {
    const a = await tune('A')
    const b = await tune('B')
    const listId = await createList(db, 'Tuesday jam')
    await addToList(db, listId, a.userTuneId)
    const { undo } = await addTunesToList(db, listId, [a.userTuneId, b.userTuneId])
    await undo()
    expect((await activeItems(db, listId)).map((i) => i.user_tune_id)).toEqual([a.userTuneId])
  })

  it('writes nothing when the list is gone', async () => {
    const a = await tune('A')
    await expect(addTunesToList(db, 'missing', [a.userTuneId])).rejects.toThrow(LIST_NOT_FOUND)
  })
})

describe('createListWithTunes', () => {
  it('creates a list holding the tunes, and undo deletes it', async () => {
    const a = await tune('A')
    const b = await tune('B')
    const undo = await createListWithTunes(db, '  Clifftop  ', [a.userTuneId, b.userTuneId])
    const list = (await db.lists.toArray()).find((l) => !l.deleted_at)!
    expect(list.name).toBe('Clifftop')
    expect((await activeItems(db, list.id)).map((i) => i.user_tune_id)).toEqual([
      a.userTuneId,
      b.userTuneId,
    ])
    await undo()
    expect((await db.lists.get(list.id))?.deleted_at).not.toBeNull()
  })

  it('rejects a blank name and writes nothing', async () => {
    const a = await tune('A')
    await expect(createListWithTunes(db, ' ', [a.userTuneId])).rejects.toThrow(LIST_NAME_REQUIRED)
    expect(await db.lists.count()).toBe(0)
  })

  it('writes nothing when a tune is missing', async () => {
    const a = await tune('A')
    await expect(createListWithTunes(db, 'Tuesday jam', [a.userTuneId, 'missing'])).rejects.toThrow(
      TUNE_NOT_FOUND,
    )
    expect((await db.lists.toArray()).some((l) => !l.deleted_at)).toBe(false)
    expect(await db.list_items.count()).toBe(0)
  })
})

describe('removeTunesFromList', () => {
  it('removes the items, and undo puts them back in their places', async () => {
    const a = await tune('A')
    const b = await tune('B')
    const c = await tune('C')
    const listId = await createList(db, 'Tuesday jam')
    const ia = await addToList(db, listId, a.userTuneId)
    const ib = await addToList(db, listId, b.userTuneId)
    const ic = await addToList(db, listId, c.userTuneId)
    const undo = await removeTunesFromList(db, [ia, ic])
    expect((await activeItems(db, listId)).map((i) => i.id)).toEqual([ib])
    await undo()
    expect((await activeItems(db, listId)).map((i) => i.id)).toEqual([ia, ib, ic])
    expect(await pendingFor(db, 'list_items', ia)).toMatchObject({ op: 'upsert' })
  })

  it('undo does not duplicate a tune added back to the list since', async () => {
    const a = await tune('A')
    const listId = await createList(db, 'Tuesday jam')
    const ia = await addToList(db, listId, a.userTuneId)
    const undo = await removeTunesFromList(db, [ia])
    await addToList(db, listId, a.userTuneId)
    await undo()
    expect((await activeItems(db, listId)).map((i) => i.user_tune_id)).toEqual([a.userTuneId])
  })

  it('undo skips a tune deleted since', async () => {
    const a = await tune('A')
    const listId = await createList(db, 'Tuesday jam')
    const ia = await addToList(db, listId, a.userTuneId)
    const undo = await removeTunesFromList(db, [ia])
    await deleteTune(db, a.tuneId)
    await undo()
    expect(await activeItems(db, listId)).toEqual([])
  })

  it('writes nothing when an item is already removed', async () => {
    const a = await tune('A')
    const b = await tune('B')
    const listId = await createList(db, 'Tuesday jam')
    const ia = await addToList(db, listId, a.userTuneId)
    const ib = await addToList(db, listId, b.userTuneId)
    await removeFromList(db, ib)
    await expect(removeTunesFromList(db, [ia, ib])).rejects.toThrow(TUNE_NOT_IN_LIST)
    expect((await activeItems(db, listId)).map((i) => i.id)).toEqual([ia])
  })

  it('undo keeps positions distinct when another tune took the freed slot', async () => {
    const a = await tune('A')
    const b = await tune('B')
    const listId = await createList(db, 'Tuesday jam')
    const ia = await addToList(db, listId, a.userTuneId)
    const undo = await removeTunesFromList(db, [ia])
    const ib = await addToList(db, listId, b.userTuneId)
    await undo()
    const items = await activeItems(db, listId)
    expect(items.map((i) => i.id)).toEqual([ia, ib])
    expect(items.map((i) => i.position)).toEqual([0, 1])
  })

  it('undo keeps a restored item when the list has a position gap', async () => {
    const a = await tune('A')
    const b = await tune('B')
    const c = await tune('C')
    const listId = await createList(db, 'Tuesday jam')
    const ia = await addToList(db, listId, a.userTuneId)
    const ib = await addToList(db, listId, b.userTuneId)
    const ic = await addToList(db, listId, c.userTuneId)
    await removeFromList(db, ia)
    const undo = await removeTunesFromList(db, [ic])
    await undo()
    expect((await activeItems(db, listId)).map((i) => i.id)).toEqual([ib, ic])
    expect((await db.list_items.get(ic))?.deleted_at).toBeNull()
  })

  it('undo restores the order after a reorder in between', async () => {
    const a = await tune('A')
    const b = await tune('B')
    const c = await tune('C')
    const listId = await createList(db, 'Tuesday jam')
    const ia = await addToList(db, listId, a.userTuneId)
    const ib = await addToList(db, listId, b.userTuneId)
    const ic = await addToList(db, listId, c.userTuneId)
    const undo = await removeTunesFromList(db, [ib])
    await moveItem(db, listId, ic, ia)
    await undo()
    const items = await activeItems(db, listId)
    // B's old slot went to A once C moved ahead of it, so B restores ahead of A.
    expect(items.map((i) => i.id)).toEqual([ic, ib, ia])
    expect(items.map((i) => i.position)).toEqual([0, 1, 2])
  })
})
