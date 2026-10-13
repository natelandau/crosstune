import type { PurchasePeriod } from '../usage/events'

export type { PurchasePeriod }

/** A plan the store sells. `price` is as RevenueCat formats it for the buyer's locale. */
export interface StoreOffer {
  period: PurchasePeriod
  price: string
  /** The store price in millionths of the currency, for comparing offers, never for display. */
  amountMicros: number
}

export type PurchaseOutcome = 'completed' | 'cancelled'

export interface Store {
  /** Annual first. Throws when RevenueCat is unreachable. */
  offers(): Promise<StoreOffer[]>
  /** Throws on any error but a user cancel. */
  purchase(period: PurchasePeriod): Promise<PurchaseOutcome>
}
