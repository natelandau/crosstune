import { X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { markNoticeSeen } from '../../billing/notices'
import { canSubscribe, type NoticeKind } from '../../billing/plan'
import { useStore } from '../../billing/StoreProvider'
import { usePlanOrUnknown } from '../../billing/usePlan'
import { useDb } from '../../db/DbProvider'
import { useOnline, useSyncEngine } from '../../sync/SyncProvider'
import { addedDay } from '../../text/format'
import { readBackEntries } from '../../ui/backEntries'
import { useOverlayOpen } from '../../ui/overlayClaim'
import { Sheet, type SheetAction, type SheetPrimary } from '../../ui/Sheet'
import { useLatest } from '../../ui/useLatest'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import { settingsPagePath } from '../settings/settingsPaths'
import {
  daysLeft,
  FIRST_RECORDING_TITLE,
  firstRecordingBody,
  LOSE_PLAYBACK,
  LOSE_RECORDING,
  LOSE_SCANS,
  NOTICE_KEEPS,
  NOTICE_OK,
  subscribeAnnual,
  TRIAL_ENDED_TITLE,
  trialReminderTitle,
} from './noticeCopy'
import { calendarDaysLeft, COMPARE_PLANS, SEE_PLAN, SUBSCRIBE } from './planCopy'
import { useCheckoutOpen, usePremiumSheet } from './PremiumSheetProvider'
import { RenewalTerms } from './RenewalTerms'
import { useDueNotice } from './useDueNotice'
import { useOffers, type Offers } from './useOffers'

type TrialNotice = Exclude<NoticeKind, 'first_recording'>

interface Showing {
  kind: NoticeKind
  /** The trial's end in the app's date format, fixed when the notice opened. */
  endsAt: string
  /** Whole calendar days left of the trial, 0 on its last day, fixed when the notice opened. */
  daysLeft: number
  open: boolean
}

/** What a trial notice offers. */
type Offer =
  /** Compare plans alone: nothing to sell here, or the store has no Annual price to show. */
  | { kind: 'compare' }
  /** Asking the store: an off Subscribe holds its place, so Compare plans never moves under a tap. */
  | { kind: 'waiting' }
  /** Annual at the store's price, over Compare plans. */
  | { kind: 'subscribe'; price: string }

/** Sells Annual only where the notice may sell, online, once the store has a price for it. */
function offerOf(sells: boolean, online: boolean, offers: Offers): Offer {
  if (!sells || !online) return { kind: 'compare' }
  if (offers.kind === 'pending') return { kind: 'waiting' }
  const annual = offers.kind === 'ready' && offers.offers.find((o) => o.period === 'annual')
  return annual ? { kind: 'subscribe', price: annual.price } : { kind: 'compare' }
}

const LOSES = [LOSE_PLAYBACK, LOSE_RECORDING, LOSE_SCANS]

/**
 * Shows the one-time plan notice that is due, one at a time, only while no overlay or checkout is
 * open, so never during a capture or over another modal. Dismissing it marks it seen on this
 * device at once and starts a sync that records it for the account. The trial notices sell
 * Annual in place where the store can; Subscribe dismisses the notice first, so the store's
 * checkout opens only once it has left.
 */
export function NoticeHost({ navigate }: { navigate: (to: string) => void }) {
  const db = useDb()
  const engine = useSyncEngine()
  const analytics = useAnalytics()
  const store = useStore()
  const plan = usePlanOrUnknown()
  const online = useOnline()
  const premium = usePremiumSheet()
  const bodyId = useId()
  // Dismissed in this session, so a notice never reopens before its seen mark is read back.
  const [dismissed, setDismissed] = useState<ReadonlySet<NoticeKind>>(new Set())
  const { kind: due, row, now } = useDueNotice(dismissed)
  // Read for the re-render when an overlay closes; the decision reads the stack itself.
  const overlayOpen = useOverlayOpen()
  const [showing, setShowing] = useState<Showing | null>(null)
  // The trial notice whose Subscribe was chosen, bought once the notice has left.
  const chosen = useRef<TrialNotice | null>(null)
  // Held from the notice leaving until its checkout ends, so the checkout opens after its sheet
  // is gone.
  const [startFor, setStartFor] = useState<TrialNotice | null>(null)
  const premiumRef = useLatest(premium)
  useEffect(() => {
    if (!startFor) return
    void premiumRef.current.checkout('annual', startFor).finally(() => setStartFor(null))
  }, [startFor, premiumRef])
  // A notice opened over the store's checkout would make it inert.
  const checkoutOpen = useCheckoutOpen()

  // A passive effect runs after every layout effect of its commit, so every overlay that opened
  // in that commit, wherever it sits in the tree, has claimed the stack by now.
  useEffect(() => {
    if (showing !== null || startFor !== null || checkoutOpen || !due || !row) return
    if (readBackEntries().some((entry) => entry.layer === 'overlay')) return
    const ends = row.trial_ends_at ?? row.premium_expires_at
    const days = ends ? calendarDaysLeft(new Date(ends), now) : 1
    // The back stack is complete only after commit, so the decision cannot be made in render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowing({ kind: due, endsAt: ends ? addedDay(ends) : '', daysLeft: days, open: true })
  }, [checkoutOpen, due, now, overlayOpen, row, showing, startFor])

  // Keyed by kind, so closing a notice, which replaces `showing`, sends nothing more.
  const sentFor = useRef<NoticeKind | null>(null)
  useEffect(() => {
    if (showing === null || sentFor.current === showing.kind) return
    sentFor.current = showing.kind
    analytics.send('notice_shown', { notice: showing.kind })
  }, [analytics, showing])

  const kind = showing?.kind
  const trial: TrialNotice | null =
    kind === 'trial_reminder' || kind === 'trial_ended' ? kind : null
  const sells = trial !== null && store !== null && canSubscribe(plan)
  const offers = useOffers(sells ? store : null, showing?.open ?? false)
  // The plan can read unknown for a moment after the notice opens; holding Subscribe's place then
  // keeps Compare plans from starting as the primary and moving aside.
  const undecided = trial !== null && store !== null && plan.kind === 'unknown'
  const offer: Offer = undecided ? { kind: 'waiting' } : offerOf(sells, online, offers)

  function dismiss() {
    if (!showing?.open) return
    const { kind } = showing
    setDismissed((current) => new Set([...current, kind]))
    setShowing({ ...showing, open: false })
    void markNoticeSeen(db, kind).then(() => engine.sync())
  }

  function compare() {
    if (!trial) return
    dismiss()
    premium.open('plan', trial)
  }

  const comparePlans: SheetAction = { label: COMPARE_PLANS, onPress: compare }
  let primary: SheetPrimary
  let tertiary: SheetAction | undefined
  if (!trial) {
    primary = {
      label: SEE_PLAN,
      onPress: () => {
        dismiss()
        navigate(settingsPagePath('account'))
      },
    }
  } else if (offer.kind === 'compare') {
    primary = comparePlans
  } else {
    tertiary = comparePlans
    primary =
      offer.kind === 'waiting'
        ? { label: SUBSCRIBE, onPress: () => {}, isDisabled: true }
        : {
            label: subscribeAnnual(offer.price),
            onPress: () => {
              if (!showing?.open) return
              chosen.current = trial
              dismiss()
            },
          }
  }

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
      height="fit"
      describedBy={bodyId}
      cancel={trial ? null : { label: NOTICE_OK }}
      closeButton={trial !== null}
      stackedActions={trial !== null}
      primary={primary}
      tertiary={tertiary}
      footnote={trial && offer.kind === 'subscribe' ? <RenewalTerms /> : undefined}
      onClosed={() => {
        setShowing(null)
        if (chosen.current) setStartFor(chosen.current)
        chosen.current = null
      }}
    >
      <div id={bodyId} className="t-body flex flex-col gap-4 pt-1">
        {kind === 'first_recording' && <p>{firstRecordingBody(endsAt)}</p>}
        {trial && (
          <>
            {trial === 'trial_reminder' && (
              <p className="t-secondary text-ink-2">{daysLeft(showing?.daysLeft ?? 1)}</p>
            )}
            <ul className="flex flex-col gap-2">
              {LOSES.map((line) => (
                <li key={line} className="flex items-start gap-2">
                  <X className="text-ink-2 mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <p className="text-ink-2">{NOTICE_KEEPS}</p>
          </>
        )}
      </div>
    </Sheet>
  )
}
