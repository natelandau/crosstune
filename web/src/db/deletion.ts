import { readStored, writeStored } from '../platform/storage'
import { deleteDatabase } from './schema'

const KEY = 'crosstune.databasesToDelete'

/**
 * Records that `userId`'s database is to be deleted, before Clerk's sign-out. A page closed
 * before the delete finishes leaves it to `settleMarkedDeletion` on the next load, and the user
 * is not admitted offline until then.
 */
export function markForDeletion(userId: string): void {
  const marked = markedForDeletion()
  if (!marked.includes(userId)) writeMarked([...marked, userId])
}

/** Every user whose database still waits for its delete. */
export function markedForDeletion(): string[] {
  try {
    const parsed: unknown = JSON.parse(readStored(KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/** Drops the mark for `userId`, as when the sign-out that set it fails. */
export function unmarkForDeletion(userId: string): void {
  writeMarked(markedForDeletion().filter((id) => id !== userId))
}

function writeMarked(ids: string[]): void {
  writeStored(KEY, ids.length > 0 ? JSON.stringify(ids) : null)
}

const deleting = new Map<string, Promise<void>>()

/** Sign-out and the gate both finish a delete; a second caller shares the first one's. */
export function deleteMarkedDatabase(userId: string): Promise<void> {
  const inFlight = deleting.get(userId)
  if (inFlight) return inFlight
  const attempt = deleteDatabase(userId)
    .then(() => unmarkForDeletion(userId))
    .finally(() => deleting.delete(userId))
  deleting.set(userId, attempt)
  return attempt
}

/**
 * Finishes the deletes that a closed page left undone, once Clerk has loaded. A user Clerk still
 * holds never finished signing out, so that database stays.
 */
export async function settleMarkedDeletion(signedInUser: string | null): Promise<void> {
  await Promise.all(
    markedForDeletion().map((userId) =>
      userId === signedInUser ? unmarkForDeletion(userId) : deleteMarkedDatabase(userId),
    ),
  )
}
