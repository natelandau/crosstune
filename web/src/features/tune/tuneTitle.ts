import type { CrosstuneDb } from '../../db/schema'

type Read = Promise<string | null> & { status?: 'fulfilled'; value?: string | null }

// Per database, so one user's titles never answer for another's.
const reads = new WeakMap<CrosstuneDb, Map<string, Read>>()

function readsFor(db: CrosstuneDb): Map<string, Read> {
  let byId = reads.get(db)
  if (!byId) reads.set(db, (byId = new Map()))
  return byId
}

/**
 * A tune's title as one cached read, for a page to suspend on with `use`. A page that waits for
 * it keeps the screen before it in place until the title can show, so the page arrives with its
 * title, the target of the row title's morph. Null once the tune is gone.
 */
export function readTuneTitle(db: CrosstuneDb, tuneId: string): Promise<string | null> {
  const byId = readsFor(db)
  let read = byId.get(tuneId)
  if (!read) {
    const pending: Read = db.tunes.get(tuneId).then(
      (tune) => (tune && !tune.deleted_at ? tune.title : null),
      // A failed read is not kept, so the next page to open the tune reads again.
      () => {
        if (byId.get(tuneId) === pending) byId.delete(tuneId)
        return null
      },
    )
    read = pending
    byId.set(tuneId, read)
  }
  return read
}

/**
 * Keeps the cached title current once the page has read the tune itself. The read is marked
 * settled, as React marks a promise it has seen, so the next page to open the tune never waits.
 */
export function rememberTuneTitle(db: CrosstuneDb, tuneId: string, title: string) {
  const byId = readsFor(db)
  if (byId.get(tuneId)?.value === title) return
  byId.set(
    tuneId,
    Object.assign(Promise.resolve(title), { status: 'fulfilled' as const, value: title }),
  )
}
