import type { LocalTune } from './types'

/** A tune present and not tombstoned, or null: the shape every caller that resolves a
 * tune reference (a recording's, a link's, a user tune's) actually needs. */
export function liveTune(tune: LocalTune | null | undefined): LocalTune | null {
  return tune && !tune.deleted_at ? tune : null
}
