import { sortPages } from '../db/notation'
import { moveBeside } from '../features/lists/order'
import { syncTables, type CrosstuneDb } from '../db/schema'
import type { LocalNotationPage } from '../db/types'
import { newId, nextPosition, now, putRow, tombstone } from './write'

/** The most live pages one tune can hold; the API refuses more. */
export const MAX_NOTATION_PAGES = 20

export class NotationPageLimitError extends Error {
  constructor() {
    super(`A tune holds at most ${MAX_NOTATION_PAGES} pages.`)
    this.name = 'NotationPageLimitError'
  }
}

export interface NewNotationPage {
  blob: Blob
  width: number
  height: number
}

function notationTx<T>(db: CrosstuneDb, fn: () => Promise<T>): Promise<T> {
  return db.transaction('rw', [...syncTables(db), db.outbox, db.notation_files], fn)
}

async function livePages(db: CrosstuneDb, tuneId: string): Promise<LocalNotationPage[]> {
  const rows = await db.notation_pages.where('tune_id').equals(tuneId).toArray()
  return sortPages(rows.filter((row) => !row.deleted_at))
}

/** Append pages after the tune's existing ones. Throws before writing when they would not fit. */
export async function addNotationPages(
  db: CrosstuneDb,
  tuneId: string,
  pages: NewNotationPage[],
): Promise<string[]> {
  const at = now()
  return notationTx(db, async () => {
    const live = await livePages(db, tuneId)
    if (live.length + pages.length > MAX_NOTATION_PAGES) throw new NotationPageLimitError()
    const start = nextPosition(live)
    const ids: string[] = []
    for (const [offset, page] of pages.entries()) {
      const id = newId()
      ids.push(id)
      await putRow(db, 'notation_pages', {
        id,
        created_at: at,
        updated_at: at,
        deleted_at: null,
        server_seq: 0,
        tune_id: tuneId,
        position: start + offset,
        width: page.width,
        height: page.height,
        state: 'pending_upload',
        file_bytes: null,
      })
      await db.notation_files.put({
        id,
        blob: page.blob,
        origin: 'captured',
        error: null,
        next_attempt_at: null,
        upload_attempts: 0,
      })
    }
    return ids
  })
}

async function writePositions(
  db: CrosstuneDb,
  ordered: readonly LocalNotationPage[],
): Promise<void> {
  const at = now()
  for (const [position, row] of ordered.entries()) {
    if (row.position !== position) {
      await putRow(db, 'notation_pages', { ...row, position, updated_at: at })
    }
  }
}

/**
 * Move a page just past another of the same tune's pages, after it when it was below and before
 * it when above, and renumber from 0. Naming the target rather than an index keeps a move made
 * against a stale screen landing beside the page the musician aimed at.
 */
export async function moveNotationPage(
  db: CrosstuneDb,
  pageId: string,
  targetId: string,
): Promise<void> {
  await notationTx(db, async () => {
    const page = await db.notation_pages.get(pageId)
    if (!page || page.deleted_at) return
    const live = await livePages(db, page.tune_id)
    await writePositions(
      db,
      moveBeside(live, (row) => row.id, pageId, targetId),
    )
  })
}

/** Tombstone a page. Its local file stays until the transfer pass drops it. */
export async function deleteNotationPage(db: CrosstuneDb, pageId: string): Promise<void> {
  await notationTx(db, () => tombstone(db, 'notation_pages', pageId, now()))
}
