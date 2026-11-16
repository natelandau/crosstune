import { readStored, writeStored } from '../platform/storage'
import { deleteDatabase } from './schema'

const KEY = 'crosstune.databaseToDelete'

/**
 * Records that `userId`'s database is to be deleted, before Clerk's sign-out. A page closed
 * before the delete finishes leaves it to `settleMarkedDeletion` on the next load, and the user
 * is not admitted offline until then.
 */
export function markForDeletion(userId: string): void {
  writeStored(KEY, userId)
}

export function markedForDeletion(): string | null {
  return readStored(KEY)
}

/** Drops the mark for `userId`, as when the sign-out that set it fails. */
export function unmarkForDeletion(userId: string): void {
  if (markedForDeletion() === userId) writeStored(KEY, null)
}

export async function deleteMarkedDatabase(userId: string): Promise<void> {
  await deleteDatabase(userId)
  unmarkForDeletion(userId)
}

/**
 * Finishes a delete that a closed page left undone, once Clerk has loaded. A user Clerk still
 * holds never finished signing out, so that database stays.
 */
export async function settleMarkedDeletion(signedInUser: string | null): Promise<void> {
  const userId = markedForDeletion()
  if (userId === null) return
  if (userId === signedInUser) unmarkForDeletion(userId)
  else await deleteMarkedDatabase(userId)
}
