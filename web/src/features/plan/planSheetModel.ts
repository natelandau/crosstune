import { canSubscribe, type Plan } from '../../billing/plan'
import type { StoreOffer } from '../../billing/store'
import type { LocalEntitlement } from '../../db/types'
import type { PurchasePeriod } from '../../usage/events'
import { saving } from './planCopy'
import type { Offers } from './useOffers'

/** The purchase options the sheet shows. */
export type PurchaseOptions =
  /** Not purchasable here: no store, or a plan that cannot subscribe. No purchase controls. */
  | { kind: 'notPurchasable' }
  /** Asking the store: Subscribe holds its place, off, so the actions never move. */
  | { kind: 'pending' }
  /** The store answered with nothing to buy. */
  | { kind: 'empty' }
  /** The device is offline; its line takes the choice's place. */
  | { kind: 'offline' }
  /** The store could not answer while online, which an alert over the sheet says. */
  | { kind: 'unavailable' }
  /** Annual or Monthly, at the store's prices, and Subscribe. */
  | { kind: 'choice'; offers: StoreOffer[] }
  /** A purchase went through before the plan turned Premium; its line replaces the choice. */
  | { kind: 'subscribed' }

/** Purchasable only by an account that can subscribe, online, once the store has a price. */
export function purchaseOptionsFor({
  hasStore,
  plan,
  online,
  offers,
  settled,
}: {
  /** Whether this build has a store to buy through. */
  hasStore: boolean
  plan: Plan
  online: boolean
  offers: Offers
  settled: boolean
}): PurchaseOptions {
  if (!hasStore) return { kind: 'notPurchasable' }
  if (settled) return { kind: 'subscribed' }
  if (!canSubscribe(plan)) return { kind: 'notPurchasable' }
  if (!online) return { kind: 'offline' }
  if (offers.kind === 'failed') return { kind: 'unavailable' }
  if (offers.kind === 'pending') return { kind: 'pending' }
  return offers.offers.length > 0 ? { kind: 'choice', offers: offers.offers } : { kind: 'empty' }
}

/** The period chosen: `period` when the store sells it, else the one period it sells. */
export function chosenPeriod(
  offers: readonly StoreOffer[],
  period: PurchasePeriod,
): PurchasePeriod | undefined {
  return offers.some((offer) => offer.period === period) ? period : offers[0]?.period
}

/**
 * Annual's saving over twelve months, worked out from the store's own two amounts, so it is
 * null unless both periods are sold.
 */
export function annualSaving(offers: readonly StoreOffer[]): number | null {
  const annual = offers.find((offer) => offer.period === 'annual')
  const monthly = offers.find((offer) => offer.period === 'monthly')
  return annual && monthly ? saving(annual.amountMicros, monthly.amountMicros) : null
}

/** Whether the renewal terms offer the withdrawal, which an account can use once. */
export function canWithdraw(entitlement: LocalEntitlement | null | undefined): boolean {
  return entitlement?.withdrawal_used !== true
}
