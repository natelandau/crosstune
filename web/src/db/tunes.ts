import type { CrosstuneDb } from './schema'
import type { LocalTune, LocalUserTune } from './types'

/** A tune present and not tombstoned, or null: the shape every caller that resolves a
 * tune reference (a recording's, a link's, a user tune's) actually needs. */
export function liveTune(tune: LocalTune | null | undefined): LocalTune | null {
  return tune && !tune.deleted_at ? tune : null
}

/** The musician's live record of `tuneId`, which holds their notes, status, and play-first pin. */
export async function readUserTune(
  db: CrosstuneDb,
  tuneId: string,
): Promise<LocalUserTune | undefined> {
  return (await db.user_tunes.where('tune_id').equals(tuneId).toArray()).find(
    (userTune) => !userTune.deleted_at,
  )
}
