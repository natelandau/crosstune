import type { CrosstuneDb } from '../db/schema'
import type { LocalEntitlement } from '../db/types'
import { planFrom, type Plan } from './plan'

/** The account's live entitlements row, or null when none is stored. */
export function liveEntitlement(db: CrosstuneDb): Promise<LocalEntitlement | null> {
  return db.entitlements
    .filter((row) => !row.deleted_at)
    .first()
    .then((row) => row ?? null)
}

/** The plan at `now`, for code outside React. */
export async function readPlan(db: CrosstuneDb, now: Date): Promise<Plan> {
  return planFrom(await liveEntitlement(db), now)
}
