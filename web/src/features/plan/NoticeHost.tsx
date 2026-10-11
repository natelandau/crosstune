import { useEffect, useId, useRef, useState } from 'react'
import { markNoticeSeen } from '../../billing/notices'
import type { NoticeKind } from '../../billing/plan'
import { useStore } from '../../billing/StoreProvider'
import { useDb } from '../../db/DbProvider'
import { useSyncEngine } from '../../sync/SyncProvider'
import { addedDay } from '../../text/format'
import { readBackEntries } from '../../ui/backEntries'
import { useOverlayOpen } from '../../ui/overlayClaim'
import { Sheet } from '../../ui/Sheet'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import { settingsPagePath } from '../settings/settingsPaths'
import {
  FIRST_RECORDING_TITLE,
  firstRecordingBody,
  NOTICE_OK,
  TRIAL_ENDED_BODY,
  TRIAL_ENDED_TITLE,
  TRIAL_REMINDER_BODY,
  TRIAL_REMINDER_RECORDINGS,
  trialReminderTitle,
} from './noticeCopy'
import { SEE_PLAN, SUBSCRIBE } from './planCopy'
import { usePremiumSheet } from './PremiumSheetProvider'
import { useDueNotice } from './useDueNotice'

interface Showing {
  kind: NoticeKind
  /** The trial's end in the app's date format, fixed when the notice opened. */
  endsAt: string
  open: boolean
}

/**
 * Shows the one-time plan notice that is due, one at a time, only while no overlay is open, so
 * never during a capture or over another modal. Dismissing it marks it seen on this device at
 * once and starts a sync that records it for the account.
 */
export function NoticeHost({ navigate }: { navigate: (to: string) => void }) {
  const db = useDb()
  const engine = useSyncEngine()
  const analytics = useAnalytics()
  const store = useStore()
  const premium = usePremiumSheet()
  const bodyId = useId()
  // Dismissed in this session, so a notice never reopens before its seen mark is read back.
  const [dismissed, setDismissed] = useState<ReadonlySet<NoticeKind>>(new Set())
  const { kind: due, row, holdsRecordings } = useDueNotice(dismissed)
  // Read for the re-render when an overlay closes; the decision reads the stack itself.
  const overlayOpen = useOverlayOpen()
  const [showing, setShowing] = useState<Showing | null>(null)

  // A passive effect runs after every layout effect of its commit, so every overlay that opened
  // in that commit, wherever it sits in the tree, has claimed the stack by now.
  useEffect(() => {
    if (showing !== null || !due || !row) return
    if (readBackEntries().some((entry) => entry.layer === 'overlay')) return
    const ends = row.trial_ends_at ?? row.premium_expires_at
    // The back stack is complete only after commit, so the decision cannot be made in render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowing({ kind: due, endsAt: ends ? addedDay(ends) : '', open: true })
  }, [due, overlayOpen, row, showing])

  // Keyed by kind, so closing a notice, which replaces `showing`, sends nothing more.
  const sentFor = useRef<NoticeKind | null>(null)
  useEffect(() => {
    if (showing === null || sentFor.current === showing.kind) return
    sentFor.current = showing.kind
    analytics.send('notice_shown', { notice: showing.kind })
  }, [analytics, showing])

  function dismiss() {
    if (!showing?.open) return
    const { kind } = showing
    setDismissed((current) => new Set([...current, kind]))
    setShowing({ ...showing, open: false })
    void markNoticeSeen(db, kind).then(() => engine.sync())
  }

  const kind = showing?.kind
  const endsAt = showing?.endsAt ?? ''
  const title =
    kind === 'first_recording'
      ? FIRST_RECORDING_TITLE
      : kind === 'trial_reminder'
        ? trialReminderTitle(endsAt)
        : TRIAL_ENDED_TITLE
  return (
    <Sheet
      isOpen={showing?.open ?? false}
      onOpenChange={(next) => {
        if (!next) dismiss()
      }}
      title={title}
      height="part"
      describedBy={bodyId}
      cancelLabel={NOTICE_OK}
      primary={
        store && (kind === 'trial_reminder' || kind === 'trial_ended')
          ? {
              label: SUBSCRIBE,
              onPress: () => {
                dismiss()
                premium.open('plan', kind)
              },
            }
          : {
              label: SEE_PLAN,
              onPress: () => {
                dismiss()
                navigate(settingsPagePath('account'))
              },
            }
      }
      onClosed={() => setShowing(null)}
    >
      <div id={bodyId} className="t-body flex flex-col gap-2 pt-2">
        {kind === 'first_recording' && <p>{firstRecordingBody(endsAt)}</p>}
        {kind === 'trial_reminder' && (
          <>
            <p>{TRIAL_REMINDER_BODY}</p>
            {holdsRecordings && <p>{TRIAL_REMINDER_RECORDINGS}</p>}
          </>
        )}
        {kind === 'trial_ended' && <p>{TRIAL_ENDED_BODY}</p>}
      </div>
    </Sheet>
  )
}
