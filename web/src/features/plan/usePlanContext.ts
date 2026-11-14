import { usePlanOrUnknown } from '../../billing/usePlan'
import type { PremiumReason } from '../../usage/events'
import type { RecordingView } from '../recordings/useRecordings'
import { planContext, type PlanContext, type PremiumSubject } from './planCopy'
import { useLiveRecordingView, useRecordingCount } from './useRecordingCount'

export interface PlanContextRead {
  /** Null while nothing asks for the plan, and until what it counts has read. */
  context: PlanContext | null
  /** The subject's recording, live: null once gone or with no subject, undefined until read. */
  subjectView: RecordingView | null | undefined
}

/**
 * What the Plan shows for `reason`, from the plan's lapse, the account's recordings, and
 * `subject`, the one recording it shows for. A caller that already holds the subject's live
 * recording passes it as `knownView`, so it is not read twice.
 */
export function usePlanContext(
  reason: PremiumReason | null,
  subject: PremiumSubject | null,
  knownView?: RecordingView,
): PlanContextRead {
  const plan = usePlanOrUnknown()
  const lapse = plan.lapse
  // Only a free plan's recordings context honors a subject or counts, so no other reads them.
  const freeRecordings = reason === 'recordings' && plan.kind === 'free'
  const lapsedRecordings = freeRecordings && lapse !== null
  const readView = useLiveRecordingView(
    knownView || !freeRecordings ? null : (subject?.recordingId ?? null),
  )
  const subjectView = knownView ?? readView
  // The count reads for as long as the context shows, so a subject that goes falls back to it at
  // once. Only a lapsed context with no subject left waits for it: with no lapse the count adds
  // only the export action, which must not hold the plan from opening.
  const recordingCount = useRecordingCount(freeRecordings)
  const waitsForCount = lapsedRecordings && (subject === null || subjectView === null)
  // Until the read answers the caller's subject stands, so the action does not flicker as the
  // plan shows; a recording deleted since leaves none.
  const named = subjectView === undefined ? subject : subjectView && subject
  // Held until the count reads, so the plan never shows the no-recordings copy first. Until then
  // a named subject counts as one recording, so its export shows at once.
  const context =
    reason && (!waitsForCount || recordingCount !== undefined)
      ? planContext({
          reason,
          lapse,
          recordingCount: recordingCount ?? (named ? 1 : 0),
          subject: named,
        })
      : null
  return { context, subjectView }
}
