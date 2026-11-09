import { useEffect, useId, useState } from 'react'
import { canSubscribe, planMode, type Plan } from '../../billing/plan'
import { storeConfig } from '../../billing/storeConfig'
import { useStore } from '../../billing/StoreProvider'
import { usePlanOrUnknown } from '../../billing/usePlan'
import { useOnline } from '../../sync/SyncProvider'
import type { PremiumReason, PurchasePeriod } from '../../usage/events'
import { useAlert } from '../../ui/Confirm'
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
  premiumCopy,
  SUBSCRIBE,
  SUBSCRIBE_OFFLINE,
  SUBSCRIBE_UNAVAILABLE_MESSAGE,
  SUBSCRIBE_UNAVAILABLE_TITLE,
  SUBSCRIBED,
  THANKS,
} from './planCopy'
import { RenewalTerms } from './RenewalTerms'
import { TrialCard } from './TrialCard'
import { useWithdrawUntil } from './useWithdrawUntil'
import { useOffers } from './useOffers'
import { chosenPeriod, purchaseOptionsFor, type PurchaseOptions } from './planSheetModel'

/**
 * The account's plan: what Free and Premium each hold, purchasable by a free or trial account,
 * or confirmed to a Premium one. A locked tap opens it leading with what was tapped. Where the store
 * has a price, Annual or Monthly, Subscribe, and the renewal terms end the page.
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
  /** A purchase went through this session, so no purchase options show until the plan follows. */
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
  const copy = reason ? premiumCopy(reason) : null
  const body = copy?.body ?? null
  const options =
    mode === 'purchasable'
      ? purchaseOptionsFor({ hasStore: store !== null, plan, online, offers, settled })
      : ({ kind: 'notPurchasable' } as const)
  const choice = options.kind === 'choice' ? options.offers : null
  // Annual by default, or the one period the store sells when it sells only one.
  const chosen = choice ? chosenPeriod(choice, period) : undefined
  const chosenPrice = choice?.find((offer) => offer.period === chosen)?.price
  const line =
    options.kind === 'subscribed'
      ? SUBSCRIBED
      : options.kind === 'offline'
        ? SUBSCRIBE_OFFLINE
        : null
  const alert = useAlert()
  const unavailable = open && reason !== null && options.kind === 'unavailable'
  useEffect(() => {
    if (!unavailable) return
    // The sheet closing, or the store answering, takes the alert away with it.
    const shown = new AbortController()
    void alert({
      title: SUBSCRIBE_UNAVAILABLE_TITLE,
      message: SUBSCRIBE_UNAVAILABLE_MESSAGE,
      signal: shown.signal,
    })
    return () => shown.abort()
  }, [unavailable, alert])
  const primary = subscribeAction(options, () => onSubscribe(chosen ?? period))
  return (
    <Sheet
      isOpen={open && reason !== null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      labelledBy={headlineId}
      height="full"
      closeButton
      primaryLarge
      inlineActions
      describedBy={mode === 'purchasable' && body ? bodyId : undefined}
      primary={primary}
      cancel={null}
      accessory={
        choice ? (
          <PeriodTiles offers={choice} period={chosen ?? period} onChange={setPeriod} />
        ) : line ? (
          <p className={`t-secondary ${options.kind === 'offline' ? 'text-secondary' : ''}`}>
            {line}
          </p>
        ) : undefined
      }
      footnote={
        chosen && chosenPrice ? <RenewalTerms price={chosenPrice} period={chosen} /> : undefined
      }
      onClosed={onClosed}
    >
      {mode === 'purchasable' ? (
        <div className="flex flex-col gap-4 pt-2">
          <div className="flex flex-col items-center gap-1 text-center">
            <Mark className="mb-3 h-10" />
            <h4 id={headlineId} className="t-screen-title break-words">
              {copy?.title ?? ''}
            </h4>
            {body && (
              <p id={bodyId} className="t-body text-secondary">
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
  const withdrawUntil = useWithdrawUntil()
  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="flex flex-col items-center gap-1 text-center">
        <Mark className="mb-3 h-10" />
        <h4 id={headlineId} className="t-screen-title">
          {ON_PREMIUM}
        </h4>
        <p className="t-body text-secondary">{THANKS}</p>
      </div>
      <MembershipCard
        membership={membership(plan, new Date(now))}
        manage={manage(plan, storeConfig().portalUrl)}
        withdrawUntil={withdrawUntil}
      />
      <IncludedList />
    </div>
  )
}

/** The Subscribe action. The header's close button is the one way out through every answer. */
function subscribeAction(
  options: PurchaseOptions,
  subscribe: () => void,
): SheetPrimary | undefined {
  switch (options.kind) {
    case 'pending':
      return { label: SUBSCRIBE, onPress: () => {}, isDisabled: true }
    case 'choice':
      return { label: SUBSCRIBE, onPress: subscribe }
    case 'notPurchasable':
    case 'empty':
    case 'offline':
    case 'unavailable':
    case 'subscribed':
      return undefined
  }
}
