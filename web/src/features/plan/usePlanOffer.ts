import { useState } from 'react'
import { canSubscribe, planMode } from '../../billing/plan'
import { useStore } from '../../billing/StoreProvider'
import { usePlanOrUnknown } from '../../billing/usePlan'
import { useOnline } from '../../sync/SyncProvider'
import type { PurchasePeriod } from '../../usage/events'
import type { SheetPrimary } from '../../ui/Sheet'
import { useResetOnChange } from '../../ui/useResetOnChange'
import { SUBSCRIBE, SUBSCRIBE_OFFLINE, SUBSCRIBED } from './planCopy'
import { chosenPeriod, purchaseOptionsFor, type PurchaseOptions } from './planSheetModel'
import { useOffers } from './useOffers'

export interface PlanOffer {
  options: PurchaseOptions
  /** The period Subscribe buys, while the store offers a choice. */
  chosen: PurchasePeriod | undefined
  setPeriod: (period: PurchasePeriod) => void
  primary: SheetPrimary | undefined
  /** Why there is nothing to buy, when that needs saying and the store answers. */
  line: string | null
  /** The store cannot answer, which each presentation says in its own way. */
  unavailable: boolean
  /** The chosen period's price, as the store formats it. */
  price: string | undefined
}

/**
 * What the account can buy while the plan shows: the store's offers, the period chosen, and
 * Subscribe. Each fresh showing starts on Annual.
 */
export function usePlanOffer(
  open: boolean,
  settled: boolean,
  onSubscribe: (period: PurchasePeriod) => void,
): PlanOffer {
  const store = useStore()
  const plan = usePlanOrUnknown()
  const online = useOnline()
  const offers = useOffers(store !== null && canSubscribe(plan) ? store : null, open)
  const [period, setPeriod] = useState<PurchasePeriod>('annual')
  useResetOnChange(open, () => {
    if (open) setPeriod('annual')
  })
  const options =
    planMode(plan) === 'purchasable'
      ? purchaseOptionsFor({ hasStore: store !== null, plan, online, offers, settled })
      : ({ kind: 'notPurchasable' } as const)
  const choice = options.kind === 'choice' ? options.offers : null
  // Annual by default, or the one period the store sells when it sells only one.
  const chosen = choice ? chosenPeriod(choice, period) : undefined
  const price = choice?.find((offer) => offer.period === chosen)?.price
  const line = offerLine(options)
  const unavailable = options.kind === 'unavailable'
  const primary = subscribeAction(options, () => onSubscribe(chosen ?? period))
  return { options, chosen, setPeriod, primary, line, unavailable, price }
}

/** Why there is nothing to buy, where the plan says so in its own text. */
function offerLine(options: PurchaseOptions): string | null {
  switch (options.kind) {
    case 'subscribed':
      return SUBSCRIBED
    case 'offline':
      return SUBSCRIBE_OFFLINE
    default:
      return null
  }
}

/** The Subscribe action, disabled while the store answers and absent when nothing can be bought. */
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
