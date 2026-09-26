import type { CrosstuneDb } from '../../db/schema'
import { isAccountDeleted } from '../../sync/errors'
import type { SyncEngine } from '../../sync/types'
import * as Sentry from '@sentry/react'
import { markAccountDeleted, markSignedOutLocally } from '../../auth/session'
import { DELETE_CONFIRMATION_TEXT } from './deleteAccountCopy'
import { forgetLocalData } from './signOut'

export function confirmMatches(text: string): boolean {
  return text.trim().toUpperCase() === DELETE_CONFIRMATION_TEXT
}

export async function countAccountData(
  db: CrosstuneDb,
): Promise<{ tunes: number; lists: number; recordings: number }> {
  const [tunes, lists, recordings] = await Promise.all([
    db.user_tunes.filter((row) => !row.deleted_at).count(),
    db.lists.filter((row) => !row.deleted_at).count(),
    db.recordings.filter((row) => !row.deleted_at).count(),
  ])
  return { tunes, lists, recordings }
}

export async function deleteAccountAndForget({
  db,
  userId,
  engine,
  signOut,
}: {
  db: CrosstuneDb
  userId: string
  engine: SyncEngine
  signOut: () => Promise<void>
}): Promise<void> {
  // A stopped engine cannot retry against an account the request below is about to erase.
  engine.stop()
  try {
    await engine.deleteAccount()
  } catch (error) {
    // Another device already deleted it, which is the outcome this request asked for.
    if (!isAccountDeleted(error)) {
      engine.resume()
      throw error
    }
  }
  await forgetDeletedAccount({ db, userId, engine, signOut })
}

/**
 * What a device does once the server has deleted the account. It never throws: the account is
 * already gone, so nothing here may tell the musician that it was not.
 */
export async function forgetDeletedAccount({
  db,
  userId,
  engine,
  signOut,
}: {
  db: CrosstuneDb
  userId: string
  engine: SyncEngine
  signOut: () => Promise<void>
}): Promise<void> {
  engine.stop()
  markAccountDeleted()
  // Clerk's copy of the user is already gone server-side, so a failed sign-out changes
  // nothing that matters; the local sign-out below covers the session it leaves behind.
  await signOut().catch(() => {})
  try {
    await forgetLocalData({ db, userId })
  } catch (error) {
    Sentry.captureException(error)
  }
  markSignedOutLocally(userId)
}
