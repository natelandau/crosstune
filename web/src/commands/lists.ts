import type { CrosstuneDb } from '../db/schema'
import type { LocalListItem } from '../db/types'
import { moveBeside } from '../features/lists/order'
import { activeByPosition, newId, nextPosition, now, putRow, tombstone, writeTx } from './write'

export async function activeItems(db: CrosstuneDb, listId: string): Promise<LocalListItem[]> {
  return activeByPosition(await db.list_items.where('list_id').equals(listId).toArray())
}

export async function createList(db: CrosstuneDb, name: string): Promise<string> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('A list needs a name')
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
  if (!trimmed) throw new Error('A list needs a name')
  await writeTx(db, async () => {
    const list = await db.lists.get(listId)
    if (!list || list.deleted_at) throw new Error('List not found')
    await putRow(db, 'lists', { ...list, name: trimmed, updated_at: now() })
  })
}

export async function deleteList(db: CrosstuneDb, listId: string): Promise<void> {
  const at = now()
  await writeTx(db, async () => {
    await tombstone(db, 'lists', listId, at)
    const items = await db.list_items.where('list_id').equals(listId).toArray()
    for (const item of items) {
      await tombstone(db, 'list_items', item.id, at, { enqueueDelete: false })
    }
  })
}

export async function addToList(
  db: CrosstuneDb,
  listId: string,
  userSongId: string,
): Promise<string> {
  const at = now()
  const id = newId()
  return writeTx(db, async () => {
    const list = await db.lists.get(listId)
    if (!list || list.deleted_at) throw new Error('List not found')
    const items = await activeItems(db, listId)
    const existing = items.find((item) => item.user_song_id === userSongId)
    if (existing) return existing.id
    await putRow(db, 'list_items', {
      id,
      created_at: at,
      updated_at: at,
      deleted_at: null,
      server_seq: 0,
      list_id: listId,
      user_song_id: userSongId,
      position: nextPosition(items),
    })
    return id
  })
}

export async function removeFromList(db: CrosstuneDb, itemId: string): Promise<void> {
  await writeTx(db, () => tombstone(db, 'list_items', itemId, now()))
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
