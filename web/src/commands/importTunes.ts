import type { TuneStatus } from '../api/vocabulary'
import type { CrosstuneDb } from '../db/schema'
import { addTunesToList } from './bulk'
import { createList } from './lists'
import { LIST_NOT_FOUND, NOTHING_TO_IMPORT } from './messages'
import { createTune } from './tunes'
import { writeTx } from './write'

export type ImportListChoice =
  { kind: 'none' } | { kind: 'new'; name: string } | { kind: 'existing'; listId: string }

export interface ImportPlan {
  titles: readonly string[]
  status: TuneStatus
  genre: string | null
  list: ImportListChoice
}

export interface ImportResult {
  userTuneIds: string[]
  listId: string | null
  listCreated: boolean
}

/**
 * Add one tune per title, and optionally put them all on a list, in a single
 * transaction so a failure leaves nothing behind. Titles keep their order on the list.
 */
export async function importTunes(db: CrosstuneDb, plan: ImportPlan): Promise<ImportResult> {
  if (plan.titles.length === 0) throw new Error(NOTHING_TO_IMPORT)
  return writeTx(db, async () => {
    let listId: string | null = null
    let listCreated = false
    if (plan.list.kind === 'existing') {
      const list = await db.lists.get(plan.list.listId)
      if (!list || list.deleted_at) throw new Error(LIST_NOT_FOUND)
      listId = list.id
    }

    const userTuneIds: string[] = []
    for (const title of plan.titles) {
      const { userTuneId } = await createTune(
        db,
        { title, genre: plan.genre },
        { status: plan.status },
      )
      userTuneIds.push(userTuneId)
    }

    if (plan.list.kind === 'new') {
      listId = await createList(db, plan.list.name)
      listCreated = true
    }
    if (listId) await addTunesToList(db, listId, userTuneIds)
    return { userTuneIds, listId, listCreated }
  })
}
