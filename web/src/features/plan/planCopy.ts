import { addedDay } from '../../text/format'

export const PLAN_GROUP = 'Plan'
export const PLAN_FREE = 'Free'
export const PLAN_PREMIUM = 'Premium'
export const PLAN_TRIAL = 'Premium trial'
export const FREE_HELP =
  'Free includes your catalog, lists, links, sync, and export. Recordings and scans on more than one tune are part of Premium.'
export const TRIAL_ENDS_TODAY = 'Ends today'
export const FREE_STORAGE_HELP = 'On the free plan, storage counts scans only.'
export const PREMIUM_RECORDINGS_TITLE = 'Recordings are part of Premium'
export const PREMIUM_SCANS_TITLE = 'Scans on more than one tune are part of Premium'
export const PREMIUM_RECORDINGS_BODY =
  'Premium keeps your recordings on our servers, so they play on every device. Every recording you already have stays: you can rename, file, delete, and export it on any plan.'
export const SEE_PLAN = 'See your plan'
export const PREMIUM_PLAN_TITLE = 'Crosstune Premium'
export const PREMIUM_PLAN_BODY =
  'Recordings that play on every device, practice mode, scans on every tune, and 5 GB of storage.'
export const SUBSCRIBE = 'Subscribe'
export const MANAGE_SUBSCRIPTION = 'Manage subscription'
export const MANAGE_APP_STORE = 'Manage in App Store settings'
export const APP_STORE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions'
export const PERIOD_ANNUAL = 'Annual'
export const PERIOD_MONTHLY = 'Monthly'
export const BILLING_PERIOD = 'Billing period'
export const BILLING_STARTS_TODAY = 'Billing starts today. The rest of your trial is not added on.'
export const RENEWS_UNTIL_CANCELLED = 'Renews until you cancel.'
export const SUBSCRIBE_OFFLINE = 'Subscribing needs a connection.'
export const SUBSCRIBED = "You're on Premium."
export const SUBSCRIBE_FAILED = "Subscribing didn't finish. Try again in a moment."

/** An annual plan's price as RevenueCat formats it, per year. */
export function annualPrice(price: string): string {
  return `${price} a year`
}

/** A monthly plan's price as RevenueCat formats it, per month. */
export function monthlyPrice(price: string): string {
  return `${price} a month`
}

/** Why scans on other tunes are held, naming the one tune they open on. */
export function premiumScansBody(tuneTitle: string): string {
  return `On the free plan, scans open on one tune, "${tuneTitle}". Pages on other tunes stay: you can delete or export them.`
}

const DAY_MS = 86_400_000

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** The trial's end and what is left of it, counted in local calendar days. */
export function trialLeft(endsAt: Date, now: Date): string {
  // Rounding absorbs the 23 or 25 hour days around a daylight saving change.
  const days = Math.round((startOfDay(endsAt) - startOfDay(now)) / DAY_MS)
  if (days <= 0) return TRIAL_ENDS_TODAY
  return `Ends ${addedDay(endsAt.toISOString())}, ${days} ${days === 1 ? 'day' : 'days'} left`
}

/** When a comp or paid grant with an end stops. */
export function premiumUntil(date: Date): string {
  return `Until ${addedDay(date.toISOString())}`
}
