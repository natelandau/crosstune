import type { AnalyticsClient } from '../../analytics/client'
import { ApiError } from '../../api/client'
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

/**
 * True when a failed delete may still have gone through. Only an answer from the API itself
 * proves the transaction rolled back: a refusal, or a problem-bearing 502 or 503 raised before
 * anything committed. A dropped connection, a gateway's bare 502 or 504, or a 500 that may
 * follow Clerk's delete leaves the outcome unknown.
 */
export function deleteOutcomeUnknown(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true
  if (error.status < 500) return false
  return !(error.problem && (error.status === 502 || error.status === 503))
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
  analytics,
}: {
  db: CrosstuneDb
  userId: string
  engine: SyncEngine
  signOut: () => Promise<void>
  analytics: AnalyticsClient
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
  await forgetDeletedAccount({ db, userId, engine, signOut, analytics })
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
  analytics,
}: {
  db: CrosstuneDb
  userId: string
  engine: SyncEngine
  signOut: () => Promise<void>
  analytics: AnalyticsClient
}): Promise<void> {
  engine.stop()
  markAccountDeleted()
  // Clerk's copy of the user is already gone server-side, so a failed sign-out changes
  // nothing that matters; the local sign-out below covers the session it leaves behind.
  await signOut().catch(() => {})
  try {
    await forgetLocalData({ db, userId, analytics })
  } catch (error) {
    Sentry.captureException(error)
  }
  // After the reset, so the event does not tie the deletion to the person.
  analytics.send('account_deleted', {})
  markSignedOutLocally(userId)
}
