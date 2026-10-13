import { useLiveQuery } from 'dexie-react-hooks'
import { useId, useState } from 'react'
import { canSubscribe, planMode, type Plan } from '../../billing/plan'
import type { StoreOffer } from '../../billing/store'
import { storeConfig } from '../../billing/storeConfig'
import { useStore } from '../../billing/StoreProvider'
import { usePlanOrUnknown } from '../../billing/usePlan'
import { useDb } from '../../db/DbProvider'
import { readScanTune } from '../../db/scans'
import { useOnline } from '../../sync/SyncProvider'
import type { PremiumReason, PurchasePeriod } from '../../usage/events'
import { Mark } from '../../ui/Mark'
import { Sheet, type SheetPrimary } from '../../ui/Sheet'
import { useNow } from '../../ui/useNow'
import { useResetOnChange } from '../../ui/useResetOnChange'
import { IncludedList } from './IncludedList'
import { manage, membership } from './membership'
import { MembershipCard } from './MembershipCard'
import { PeriodTiles } from './PeriodTiles'
import { PlanComparison } from './PlanComparison'
import {
  ON_PREMIUM,
  PREMIUM_PITCH,
  PREMIUM_PLAN_TITLE,
  PREMIUM_RECORDINGS_BODY,
  PREMIUM_RECORDINGS_TITLE,
  PREMIUM_SCANS_TITLE,
  premiumScansBody,
  SUBSCRIBE,
  SUBSCRIBE_OFFLINE,
  SUBSCRIBED,
  THANKS,
} from './planCopy'
import { RenewalTerms } from './RenewalTerms'
import { TrialCard } from './TrialCard'
import { useOffers, type Offers } from './useOffers'

const TITLES: Record<PremiumReason, string> = {
  recordings: PREMIUM_RECORDINGS_TITLE,
  scans: PREMIUM_SCANS_TITLE,
  plan: PREMIUM_PLAN_TITLE,
}

/** What the sheet offers to buy. */
type Sale =
  /** Nothing to sell here: no store, or a plan that cannot subscribe. No purchase controls. */
  | { kind: 'notSelling' }
  /** Asking the store: Subscribe holds its place, off, so the actions never move. */
  | { kind: 'pending' }
  /** The store answered with nothing to sell. */
  | { kind: 'empty' }
  /** The store could not be reached; its line takes the choice's place. */
  | { kind: 'offline' }
  /** Annual or Monthly, at the store's prices, and Subscribe. */
  | { kind: 'choice'; offers: StoreOffer[] }
  /** A purchase went through before the plan turned Premium; its line stands in for the choice. */
  | { kind: 'subscribed' }

/** Sells only to an account that can subscribe, online, once the store has answered with a price. */
function saleOf({
  selling,
  plan,
  online,
  offers,
  settled,
}: {
  /** Whether this build has a store to sell through. */
  selling: boolean
  plan: Plan
  online: boolean
  offers: Offers
  settled: boolean
}): Sale {
  if (!selling) return { kind: 'notSelling' }
  if (settled) return { kind: 'subscribed' }
  if (!canSubscribe(plan)) return { kind: 'notSelling' }
  if (!online || offers.kind === 'failed') return { kind: 'offline' }
  if (offers.kind === 'pending') return { kind: 'pending' }
  return offers.offers.length > 0 ? { kind: 'choice', offers: offers.offers } : { kind: 'empty' }
}

/**
 * The title of the one tune a free account's scans open on, read only while asked for:
 * undefined until read, and the title null when there is no scan tune.
 */
function useScanTuneTitle(asked: boolean): { title: string | null } | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    if (!asked) return undefined
    const tuneId = await readScanTune(db)
    return { title: tuneId === null ? null : ((await db.tunes.get(tuneId))?.title ?? null) }
  }, [db, asked])
}

/**
 * The account's plan: what Free and Premium each hold, sold to a free or trial account, or
 * confirmed to a Premium one. A locked tap opens it leading with what was tapped. Where the store
 * can sell, Annual or Monthly, Subscribe, and the renewal terms end the page.
 */
export function PlanSheet({
  open,
  reason,
  settled,
  onClose,
  onClosed,
  onSubscribe,
}: {
  open: boolean
  /** Kept until the sheet has left, so it does not change as it closes; null once it has. */
  reason: PremiumReason | null
  /** A purchase went through this session, so the sheet stops selling until the plan follows. */
  settled: boolean
  onClose: () => void
  onClosed: () => void
  onSubscribe: (period: PurchasePeriod) => void
}) {
  const bodyId = useId()
  const headlineId = useId()
  const store = useStore()
  const plan = usePlanOrUnknown()
  const online = useOnline()
  const mode = planMode(plan)
  const offers = useOffers(store !== null && canSubscribe(plan) ? store : null, open)
  const [period, setPeriod] = useState<PurchasePeriod>('annual')
  useResetOnChange(open, () => {
    if (open) setPeriod('annual')
  })
  const scan = useScanTuneTitle(reason === 'scans')
  const body =
    reason === 'recordings'
      ? PREMIUM_RECORDINGS_BODY
      : reason === 'plan'
        ? PREMIUM_PITCH
        : reason === 'scans' && scan?.title
          ? premiumScansBody(scan.title)
          : null
  // The scans sheet waits for its tune's title, so it opens with its body already in place.
  const ready =
    reason === 'recordings' || reason === 'plan' || (reason === 'scans' && scan !== undefined)
  const sale =
    mode === 'selling'
      ? saleOf({ selling: store !== null, plan, online, offers, settled })
      : ({ kind: 'notSelling' } as const)
  const choice = sale.kind === 'choice' ? sale.offers : null
  // Annual by default, or the one period the store sells when it sells only one.
  const chosen = choice?.some((offer) => offer.period === period) ? period : choice?.[0]?.period
  const line =
    sale.kind === 'subscribed' ? SUBSCRIBED : sale.kind === 'offline' ? SUBSCRIBE_OFFLINE : null
  const primary = subscribeAction(sale, () => onSubscribe(chosen ?? period))
  return (
    <Sheet
      isOpen={open && ready}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      labelledBy={headlineId}
      height="full"
      closeButton
      primaryLarge
      inlineActions
      describedBy={mode === 'selling' && body ? bodyId : undefined}
      primary={primary}
      cancel={null}
      accessory={
        choice ? (
          <PeriodTiles offers={choice} period={chosen ?? period} onChange={setPeriod} />
        ) : line ? (
          <p className={`t-secondary ${sale.kind === 'offline' ? 'text-ink-2' : ''}`}>{line}</p>
        ) : undefined
      }
      footnote={choice ? <RenewalTerms /> : undefined}
      onClosed={onClosed}
    >
      {mode === 'selling' ? (
        <div className="flex flex-col gap-4 pt-2">
          <div className="flex flex-col items-center gap-1 text-center">
            <Mark className="mb-3 h-10" />
            <h4 id={headlineId} className="t-screen-title break-words">
              {reason ? TITLES[reason] : ''}
            </h4>
            {body && (
              <p id={bodyId} className="t-body text-ink-2">
                {body}
              </p>
            )}
          </div>
          {plan.kind === 'premium' && plan.source === 'trial' && (
            <TrialCard
              startsAt={plan.trialStartsAt}
              endsAt={plan.trialEndsAt ?? plan.premiumEndsAt}
            />
          )}
          <PlanComparison />
        </div>
      ) : (
        <Member plan={plan} headlineId={headlineId} />
      )}
    </Sheet>
  )
}

/** A Premium account's plan: the mark and thanks, the membership, and what Premium includes. */
function Member({ plan, headlineId }: { plan: Plan; headlineId: string }) {
  const now = useNow()
  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="flex flex-col items-center gap-1 text-center">
        <Mark className="mb-3 h-10" />
        <h4 id={headlineId} className="t-screen-title">
          {ON_PREMIUM}
        </h4>
        <p className="t-body text-ink-2">{THANKS}</p>
      </div>
      <MembershipCard
        membership={membership(plan, new Date(now))}
        manage={manage(plan, storeConfig().portalUrl)}
      />
      <IncludedList />
    </div>
  )
}

/** The sale's Subscribe. The header's close button is the one way out through every answer. */
function subscribeAction(sale: Sale, subscribe: () => void): SheetPrimary | undefined {
  switch (sale.kind) {
    case 'pending':
      return { label: SUBSCRIBE, onPress: () => {}, isDisabled: true }
    case 'choice':
      return { label: SUBSCRIBE, onPress: subscribe }
    case 'notSelling':
    case 'empty':
    case 'offline':
    case 'subscribed':
      return undefined
  }
}
