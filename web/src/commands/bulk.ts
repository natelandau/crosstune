import { INSTRUMENTS, type Instrument } from '../api/vocabulary'
import type { CrosstuneDb } from '../db/schema'
import type { LocalListItem, LocalTune, LocalUserTune } from '../db/types'
import { activeItems, createList, deleteList, writeOrder } from './lists'
import { setTuning, tuningsMap } from '../features/settings/instruments'
import { LIST_NOT_FOUND, TUNE_NOT_FOUND, TUNE_NOT_IN_LIST } from './messages'
import { tombstoneTune, type TuneInput, type UserTuneInput } from './tunes'
import { newId, nextPosition, now, putRow, recordingTx, tombstone, writeTx } from './write'

export type Undo = () => Promise<void>

/** Fields that describe many tunes at once; per-tune text such as titles and notes is left out. */
export interface BulkPatch {
  tune?: Partial<Omit<TuneInput, 'title' | 'alternate_titles' | 'tunings'>>
  userTune?: Partial<Omit<UserTuneInput, 'notes'>>
  /** A tuning per instrument; null clears it. Capos and other instruments are kept. */
  tunings?: Partial<Record<Instrument, string | null>>
}

type Fields = Record<string, unknown>

/** The previous values of the fields a bulk write changed on one row. */
export interface Snapshot {
  table: 'tunes' | 'user_tunes'
  id: string
  before: Fields
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)]
}

/** The patch entries that would change the row, skipping undefined, which means keep. */
function changes(row: object, patch: Fields): Fields {
  const current = row as Fields
  return Object.fromEntries(
    Object.entries(patch).filter(([key, value]) => value !== undefined && current[key] !== value),
  )
}

function previous(row: object, changed: Fields): Fields {
  const current = row as Fields
  return Object.fromEntries(Object.keys(changed).map((key) => [key, current[key]]))
}

/**
 * Write back each snapshot's fields onto the row as it is now, so edits made to other
 * fields since the bulk write survive. A row deleted since is skipped.
 */
export async function restoreFields(
  db: CrosstuneDb,
  snapshots: readonly Snapshot[],
): Promise<void> {
  if (snapshots.length === 0) return
  await writeTx(db, async () => {
    const at = now()
    for (const { table, id, before } of snapshots) {
      if (table === 'tunes') {
        const row = await db.tunes.get(id)
        if (!row || row.deleted_at) continue
        await putRow(db, 'tunes', { ...row, ...(before as Partial<LocalTune>), updated_at: at })
      } else {
        const row = await db.user_tunes.get(id)
        if (!row || row.deleted_at) continue
        await putRow(db, 'user_tunes', {
          ...row,
          ...(before as Partial<LocalUserTune>),
          updated_at: at,
        })
      }
    }
  })
}

export async function updateTunes(
  db: CrosstuneDb,
  userTuneIds: readonly string[],
  patch: BulkPatch,
): Promise<Undo> {
  const tunePatch = (patch.tune ?? {}) as Fields
  const userTunePatch = (patch.userTune ?? {}) as Fields
  const snapshots: Snapshot[] = []
  await writeTx(db, async () => {
    const at = now()
    for (const userTuneId of unique(userTuneIds)) {
      const userTune = await db.user_tunes.get(userTuneId)
      if (!userTune || userTune.deleted_at) throw new Error(TUNE_NOT_FOUND)
      const tune = await db.tunes.get(userTune.tune_id)
      if (!tune || tune.deleted_at) throw new Error(TUNE_NOT_FOUND)

      let rowPatch = tunePatch
      if (patch.tunings) {
        let tunings = tuningsMap(tune.tunings)
        for (const instrument of INSTRUMENTS) {
          const tuning = patch.tunings[instrument]
          if (tuning !== undefined) tunings = setTuning(tunings, instrument, { tuning })
        }
        // setTuning returns a new object every time, so compare by value to skip a tune the
        // patch leaves as it was.
        if (JSON.stringify(tunings) !== JSON.stringify(tune.tunings)) {
          rowPatch = { ...tunePatch, tunings }
        }
      }
      const tuneChanges = changes(tune, rowPatch)
      if (Object.keys(tuneChanges).length > 0) {
        snapshots.push({ table: 'tunes', id: tune.id, before: previous(tune, tuneChanges) })
        await putRow(db, 'tunes', {
          ...tune,
          ...(tuneChanges as Partial<LocalTune>),
          updated_at: at,
        })
      }

      const userTuneChanges = changes(userTune, userTunePatch)
      if (Object.keys(userTuneChanges).length > 0) {
        snapshots.push({
          table: 'user_tunes',
          id: userTune.id,
          before: previous(userTune, userTuneChanges),
        })
        await putRow(db, 'user_tunes', {
          ...userTune,
          ...(userTuneChanges as Partial<LocalUserTune>),
          updated_at: at,
        })
      }
    }
  })
  return () => restoreFields(db, snapshots)
}

export async function setArchivedMany(
  db: CrosstuneDb,
  userTuneIds: readonly string[],
  archived: boolean,
): Promise<Undo> {
  const snapshots: Snapshot[] = []
  await writeTx(db, async () => {
    const at = now()
    for (const id of unique(userTuneIds)) {
      const userTune = await db.user_tunes.get(id)
      if (!userTune || userTune.deleted_at) throw new Error(TUNE_NOT_FOUND)
      if ((userTune.archived_at !== null) === archived) continue
      snapshots.push({ table: 'user_tunes', id, before: { archived_at: userTune.archived_at } })
      await putRow(db, 'user_tunes', {
        ...userTune,
        archived_at: archived ? at : null,
        updated_at: at,
      })
    }
  })
  return () => restoreFields(db, snapshots)
}

/**
 * Delete the tunes behind the given user tunes, each with its links, list entries, and
 * recordings. There is no undo: a recording this takes with it is gone from every device.
 */
export async function deleteTunes(
  db: CrosstuneDb,
  userTuneIds: readonly string[],
): Promise<number> {
  return recordingTx(db, async () => {
    const at = now()
    const tuneIds = new Set<string>()
    for (const id of unique(userTuneIds)) {
      const userTune = await db.user_tunes.get(id)
      if (!userTune || userTune.deleted_at) throw new Error(TUNE_NOT_FOUND)
      tuneIds.add(userTune.tune_id)
    }
    for (const tuneId of tuneIds) await tombstoneTune(db, tuneId, at)
    return tuneIds.size
  })
}

export async function addTunesToList(
  db: CrosstuneDb,
  listId: string,
  userTuneIds: readonly string[],
): Promise<{ undo: Undo; added: number }> {
  const created: string[] = []
  await writeTx(db, async () => {
    const list = await db.lists.get(listId)
    if (!list || list.deleted_at) throw new Error(LIST_NOT_FOUND)
    const items = await activeItems(db, listId)
    const members = new Set(items.map((item) => item.user_tune_id))
    let position = nextPosition(items)
    const at = now()
    for (const userTuneId of unique(userTuneIds)) {
      if (members.has(userTuneId)) continue
      const userTune = await db.user_tunes.get(userTuneId)
      if (!userTune || userTune.deleted_at) throw new Error(TUNE_NOT_FOUND)
      const id = newId()
      await putRow(db, 'list_items', {
        id,
        created_at: at,
        updated_at: at,
        deleted_at: null,
        server_seq: 0,
        list_id: listId,
        user_tune_id: userTuneId,
        position,
      })
      position += 1
      members.add(userTuneId)
      created.push(id)
    }
  })
  return {
    added: created.length,
    undo: async () => {
      if (created.length === 0) return
      await writeTx(db, async () => {
        const at = now()
        for (const id of created) await tombstone(db, 'list_items', id, at)
      })
    },
  }
}

export async function createListWithTunes(
  db: CrosstuneDb,
  name: string,
  userTuneIds: readonly string[],
): Promise<Undo> {
  const listId = await writeTx(db, async () => {
    const id = await createList(db, name)
    await addTunesToList(db, id, userTuneIds)
    return id
  })
  return () => deleteList(db, listId)
}

export async function removeTunesFromList(
  db: CrosstuneDb,
  itemIds: readonly string[],
): Promise<Undo> {
  const removed: string[] = []
  await writeTx(db, async () => {
    const at = now()
    for (const id of unique(itemIds)) {
      const item = await db.list_items.get(id)
      if (!item || item.deleted_at) throw new Error(TUNE_NOT_IN_LIST)
      await tombstone(db, 'list_items', id, at)
      removed.push(id)
    }
  })
  return async () => {
    if (removed.length === 0) return
    await writeTx(db, async () => {
      const at = now()
      const restorable: LocalListItem[] = []
      for (const id of removed) {
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
}
