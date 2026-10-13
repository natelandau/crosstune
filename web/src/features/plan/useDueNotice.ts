import { useLiveQuery } from 'dexie-react-hooks'
import { dueUnseenNotice, seenNotices } from '../../billing/notices'
import type { NoticeKind } from '../../billing/plan'
import { usePlanCheckOrUnknown } from '../../billing/usePlan'
import { useDb } from '../../db/DbProvider'
import type { LocalEntitlement } from '../../db/types'

export interface DueNotice {
  /** The notice to show now; null when none is due or a read failed, undefined until every read
   * has answered. */
  kind: NoticeKind | null | undefined
  row: LocalEntitlement | null | undefined
  /** The time the notice is judged at. */
  now: Date
}

const NONE: ReadonlySet<NoticeKind> = new Set()

/**
 * The one-time plan notice due now, leaving out those seen on this device and `dismissed`. It
 * never throws: it sits above every error boundary, and a failed read shows no notice.
 */
export function useDueNotice(dismissed: ReadonlySet<NoticeKind> = NONE): DueNotice {
  const db = useDb()
  const { row, now } = usePlanCheckOrUnknown()
  const holdsRecordings = useLiveQuery(
    () =>
      db.recordings
        .filter((recording) => !recording.deleted_at)
        .first()
        .then((recording) => recording !== undefined)
        .catch(() => null),
    [db],
  )
  const seen = useLiveQuery(() => seenNotices(db).catch(() => null), [db])
  let kind: NoticeKind | null | undefined
  if (row === undefined || holdsRecordings === undefined || seen === undefined) kind = undefined
  else if (holdsRecordings === null || seen === null) kind = null
  else kind = dueUnseenNotice(row, now, holdsRecordings, new Set([...seen, ...dismissed]))
  return { kind, row, now }
}
