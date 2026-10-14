import type { SyncApi } from '../api/types'
import { ApiError } from '../api/client'
import { getMeta, META_REFUSED_NOTICES, META_SEEN_NOTICES, setMeta } from '../db/meta'
import type { CrosstuneDb } from '../db/schema'
import type { LocalEntitlement } from '../db/types'
import { isAuthFailure, isRetryableRefusal } from '../sync/errors'
import { liveEntitlement } from './entitlement'
import { dueNotice, type NoticeKind } from './plan'

/** The row column the server stamps when the account has seen each notice. */
const SEEN_COLUMN = {
  first_recording: 'recording_notice_seen_at',
  trial_reminder: 'trial_reminder_seen_at',
  trial_ended: 'trial_end_seen_at',
} as const satisfies Record<NoticeKind, keyof LocalEntitlement>

/** The notices this device has seen that the server may not have recorded yet. */
export async function seenNotices(db: CrosstuneDb): Promise<Set<NoticeKind>> {
  return new Set(await getMeta<NoticeKind[]>(db, META_SEEN_NOTICES, []))
}

/** Records a notice as seen on this device at once, so it never shows here again, until the
 * next sync posts it for the account. */
export async function markNoticeSeen(db: CrosstuneDb, notice: NoticeKind): Promise<void> {
  await db.transaction('rw', db.meta, async () => {
    const seen = await seenNotices(db)
    if (seen.has(notice)) return
    seen.add(notice)
    await setMeta(db, META_SEEN_NOTICES, [...seen])
  })
}

async function refusedNotices(db: CrosstuneDb): Promise<Set<NoticeKind>> {
  return new Set(await getMeta<NoticeKind[]>(db, META_REFUSED_NOTICES, []))
}

/**
 * Posts each notice seen on this device that the stored row does not carry yet, and forgets
 * each one the row now carries. A failed post stays for the next sync, unless the server refused
 * the request itself, which a resend would only draw again: that notice stays seen here and is
 * never posted again. Once every notice has had its turn, the first auth failure is rethrown, or
 * else the first failure.
 */
export async function postSeenNotices(db: CrosstuneDb, api: SyncApi): Promise<void> {
  const seen = await seenNotices(db)
  if (seen.size === 0) return
  const row = await liveEntitlement(db)
  const carried = [...seen].filter((notice) => row?.[SEEN_COLUMN[notice]] != null)
  if (carried.length > 0) {
    await db.transaction('rw', db.meta, async () => {
      const current = await seenNotices(db)
      const refused = await refusedNotices(db)
      for (const notice of carried) {
        current.delete(notice)
        refused.delete(notice)
      }
      await setMeta(db, META_SEEN_NOTICES, [...current])
      await setMeta(db, META_REFUSED_NOTICES, [...refused])
    })
  }
  const refused = await refusedNotices(db)
  let failure: unknown = null
  for (const notice of seen) {
    if (carried.includes(notice) || refused.has(notice)) continue
    try {
      await api.recordNotice(notice)
    } catch (error) {
      if (error instanceof ApiError && !isRetryableRefusal(error)) {
        await db.transaction('rw', db.meta, async () => {
          const current = await refusedNotices(db)
          current.add(notice)
          await setMeta(db, META_REFUSED_NOTICES, [...current])
        })
      }
      if (failure === null || (isAuthFailure(error) && !isAuthFailure(failure))) failure = error
    }
  }
  if (failure !== null) throw failure
}

/** The notice due now, leaving out every one this device has already seen. */
export function dueUnseenNotice(
  row: LocalEntitlement | null | undefined,
  now: Date,
  holdsRecordings: boolean,
  seen: ReadonlySet<NoticeKind>,
): NoticeKind | null {
  if (!row) return null
  const marked = { ...row }
  for (const notice of seen) marked[SEEN_COLUMN[notice]] ??= now.toISOString()
  return dueNotice(marked, now, holdsRecordings)
}
