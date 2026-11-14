import { useEffect, useId } from 'react'
import { planMode, type Plan } from '../../billing/plan'
import { storeConfig } from '../../billing/storeConfig'
import { usePlanOrUnknown } from '../../billing/usePlan'
import type { PurchasePeriod } from '../../usage/events'
import { useAlert } from '../../ui/Confirm'
import { Mark } from '../../ui/Mark'
import { HeadingLevelContext, useSubheadingLevel } from '../../ui/headingLevel'
import { Sheet } from '../../ui/Sheet'
import { useNow } from '../../ui/useNow'
import { IncludedList } from './IncludedList'
import { manage, membership } from './membership'
import { MembershipCard } from './MembershipCard'
import { renderOfferChoice } from './renderOfferChoice'
import { PlanExport, PlanPanel } from './PlanPanel'
import {
  ON_PREMIUM,
  SUBSCRIBE_UNAVAILABLE_MESSAGE,
  SUBSCRIBE_UNAVAILABLE_TITLE,
  THANKS,
  type PlanAction,
  type PlanContext,
} from './planCopy'
import { RenewalTerms } from './RenewalTerms'
import { usePlanOffer } from './usePlanOffer'
import { useWithdrawUntil } from './useWithdrawUntil'

/**
 * The account's plan: what Free and Premium each hold, purchasable by a free or trial account,
 * or confirmed to a Premium one. A locked tap opens it leading with what was tapped. Where the store
 * has a price, Annual or Monthly, Subscribe, and the renewal terms end the page.
 */
export function PlanSheet({
  open,
  context,
  settled,
  onClose,
  onClosed,
  onSubscribe,
  onAction,
}: {
  open: boolean
  /** Kept until the sheet has left, so it does not change as it closes; null once it has. */
  context: PlanContext | null
  /** A purchase went through this session, so no purchase options show until the plan follows. */
  settled: boolean
  onClose: () => void
  onClosed: () => void
  onSubscribe: (period: PurchasePeriod) => void
  onAction: (action: PlanAction) => void
}) {
  const bodyId = useId()
  const headlineId = useId()
  const plan = usePlanOrUnknown()
  const mode = planMode(plan)
  const shown = open && context !== null
  const offer = usePlanOffer(shown, settled, onSubscribe)
  const { chosen, price } = offer
  useUnavailableAlert(shown && offer.unavailable)
  return (
    <Sheet
      isOpen={shown}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      labelledBy={headlineId}
      height="full"
      closeButton
      primaryLarge
      inlineActions
      describedBy={mode === 'purchasable' && context?.body ? bodyId : undefined}
      primary={offer.primary}
      cancel={null}
      accessory={renderOfferChoice(offer)}
      footnote={
        mode === 'purchasable' && (context?.action || (chosen && price)) ? (
          <>
            <PlanExport context={context} onAction={onAction} />
            {chosen && price && <RenewalTerms price={price} period={chosen} />}
          </>
        ) : undefined
      }
      onClosed={onClosed}
    >
      {/* The headline stands as the sheet's title, since the sheet has none of its own. */}
      <HeadingLevelContext value={1}>
        {mode === 'purchasable' ? (
          <PlanPanel context={context} headlineId={headlineId} bodyId={bodyId} />
        ) : (
          <Member plan={plan} headlineId={headlineId} />
        )}
      </HeadingLevelContext>
    </Sheet>
  )
}

/** Raises the alert that the store cannot answer while `raised`; it leaves when that ends. */
function useUnavailableAlert(raised: boolean) {
  const alert = useAlert()
  useEffect(() => {
    if (!raised) return
    const shown = new AbortController()
    void alert({
      title: SUBSCRIBE_UNAVAILABLE_TITLE,
      message: SUBSCRIBE_UNAVAILABLE_MESSAGE,
      signal: shown.signal,
    })
    return () => shown.abort()
  }, [raised, alert])
}

/** A Premium account's plan: the mark and thanks, the membership, and what Premium includes. */
function Member({ plan, headlineId }: { plan: Plan; headlineId: string }) {
  const now = useNow()
  const withdrawUntil = useWithdrawUntil()
  const level = useSubheadingLevel()
  const Headline = `h${level}` as const
  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="flex flex-col items-center gap-1 text-center">
        <Mark className="mb-3 h-10" />
        <Headline id={headlineId} className="t-screen-title">
          {ON_PREMIUM}
        </Headline>
        <p className="t-body text-secondary">{THANKS}</p>
      </div>
      <MembershipCard
        membership={membership(plan, new Date(now))}
        manage={manage(plan, storeConfig().portalUrl)}
        withdrawUntil={withdrawUntil}
      />
      <HeadingLevelContext value={level}>
        <IncludedList />
      </HeadingLevelContext>
    </div>
  )
}
