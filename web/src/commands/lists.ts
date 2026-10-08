import type { CrosstuneDb } from '../db/schema'
import type { LocalListItem } from '../db/types'
import { moveBeside } from '../domain/order'
import { LIST_NAME_REQUIRED, LIST_NOT_FOUND } from './messages'
import {
  activeByPosition,
  newId,
  nextPosition,
  now,
  putRow,
  tombstone,
  tombstoneWhere,
  writeTx,
} from './write'

export async function activeItems(db: CrosstuneDb, listId: string): Promise<LocalListItem[]> {
  return activeByPosition(await db.list_items.where('list_id').equals(listId).toArray())
}

export async function createList(db: CrosstuneDb, name: string): Promise<string> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error(LIST_NAME_REQUIRED)
  const at = now()
  const id = newId()
  await writeTx(db, async () => {
    const lists = await db.lists.toArray()
    const position = nextPosition(lists.filter((list) => !list.deleted_at))
    await putRow(db, 'lists', {
      id,
      created_at: at,
      updated_at: at,
      deleted_at: null,
      server_seq: 0,
      name: trimmed,
      position,
    })
  })
  return id
}

export async function renameList(db: CrosstuneDb, listId: string, name: string): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error(LIST_NAME_REQUIRED)
  await writeTx(db, async () => {
    const list = await db.lists.get(listId)
    if (!list || list.deleted_at) throw new Error(LIST_NOT_FOUND)
    await putRow(db, 'lists', { ...list, name: trimmed, updated_at: now() })
  })
}

export async function deleteList(db: CrosstuneDb, listId: string): Promise<void> {
  const at = now()
  await writeTx(db, async () => {
    await tombstone(db, 'lists', listId, at)
    await tombstoneWhere(db, 'list_items', 'list_id', listId, at)
  })
}

export async function addToList(
  db: CrosstuneDb,
  listId: string,
  userTuneId: string,
): Promise<string> {
  const at = now()
  const id = newId()
  return writeTx(db, async () => {
    const list = await db.lists.get(listId)
    if (!list || list.deleted_at) throw new Error(LIST_NOT_FOUND)
    const items = await activeItems(db, listId)
    const existing = items.find((item) => item.user_tune_id === userTuneId)
    if (existing) return existing.id
    await putRow(db, 'list_items', {
      id,
      created_at: at,
      updated_at: at,
      deleted_at: null,
      server_seq: 0,
      list_id: listId,
      user_tune_id: userTuneId,
      position: nextPosition(items),
    })
    return id
  })
}

/** Takes the item out of its list, returning what puts it back. */
export async function removeFromList(
  db: CrosstuneDb,
  itemId: string,
): Promise<() => Promise<void>> {
  await writeTx(db, () => tombstone(db, 'list_items', itemId, now()))
  return () => restoreListItems(db, [itemId])
}

/**
 * Puts removed items back in their lists, each at the place it held. An item whose list or
 * tune has since gone, or whose tune is back in the list another way, stays out.
 */
export async function restoreListItems(db: CrosstuneDb, itemIds: readonly string[]): Promise<void> {
  if (itemIds.length === 0) return
  await writeTx(db, async () => {
    const at = now()
    const restorable: LocalListItem[] = []
    for (const id of itemIds) {
      const item = await db.list_items.get(id)
      if (!item || !item.deleted_at) continue
      const list = await db.lists.get(item.list_id)
      const userTune = await db.user_tunes.get(item.user_tune_id)
      if (!list || list.deleted_at || !userTune || userTune.deleted_at) continue
      restorable.push(item)
    }
    const byList = new Map<string, LocalListItem[]>()
    for (const item of restorable) {
      const items = byList.get(item.list_id) ?? []
      items.push(item)
      byList.set(item.list_id, items)
    }
    for (const [listId, items] of byList) {
      const active = await activeItems(db, listId)
      const members = new Set(active.map((member) => member.user_tune_id))
      const toRestore = items.filter((item) => !members.has(item.user_tune_id))
      if (toRestore.length === 0) continue
      const restored = toRestore.map((item) => ({ ...item, deleted_at: null, updated_at: at }))
      const restoredIds = new Set(restored.map((item) => item.id))
      for (const item of restored) await putRow(db, 'list_items', item)
      // The freed position may already be reused by another item, so restored
      // rows compete for their old slot: a restored item held it first.
      const merged = [...active, ...restored].sort((a, b) => {
        if (a.position !== b.position) return a.position - b.position
        return Number(restoredIds.has(b.id)) - Number(restoredIds.has(a.id))
      })
      await writeOrder(db, merged)
    }
  })
}

/** Renumber from 0, touching only the rows whose position changed. */
export async function writeOrder(db: CrosstuneDb, ordered: LocalListItem[]): Promise<void> {
  const at = now()
  for (const [position, item] of ordered.entries()) {
    if (item.position !== position) {
      await putRow(db, 'list_items', { ...item, position, updated_at: at })
    }
  }
}

/** Move an item just past the target; see moveBeside. */
export async function moveItem(
  db: CrosstuneDb,
  listId: string,
  itemId: string,
  targetItemId: string,
): Promise<void> {
  await writeTx(db, async () => {
    const items = await activeItems(db, listId)
    await writeOrder(
      db,
      moveBeside(items, (item) => item.id, itemId, targetItemId),
    )
  })
}
