import { addedDay, recordedTime } from '../../text/format'
import { localDaysBetween } from '../../text/localDate'
import type { PurchasePeriod } from '../../usage/events'

export const PLAN_GROUP = 'Plan'
export const PLAN_FREE = 'Free'
export const PLAN_PREMIUM = 'Premium'
export const PLAN_TRIAL = 'Premium trial'
export const FREE_HELP =
  'Free includes your catalog, lists, links, sync, and export. Recordings and scans are part of Premium.'
export const TRIAL_ENDS_TODAY = 'Ends today'
export const PREMIUM_RECORDINGS_TITLE = 'Recordings are part of Premium'
export const PREMIUM_SCANS_TITLE = 'Scans are part of Premium'
export const PREMIUM_RECORDINGS_BODY =
  'Premium keeps your recordings on our servers, so they play on every device. Every recording you already have stays: you can rename, file, delete, and export it on any plan.'
export const PREMIUM_SCANS_BODY =
  'Premium keeps your scans on our servers, so they open on every device. Every scan you already have stays: you can delete and export it on any plan.'
export const SEE_PLAN = 'See your plan'
export const PREMIUM_PLAN_TITLE = 'Crosstune Premium'
export const SUBSCRIBE = 'Subscribe'
export const MANAGE_SUBSCRIPTION = 'Manage subscription'
export const WITHDRAW_LABEL = 'Withdraw for a full refund'
export const WITHDRAW_CONFIRM_ACTION = 'Withdraw'
export const WITHDRAW_CONFIRM_TITLE = 'Withdraw and refund?'
export const WITHDRAW_CONFIRM_BODY = 'We refund your first payment in full and Premium ends now.'
export const WITHDRAW_DONE = 'Your payment was refunded and Premium has ended.'
export const WITHDRAW_REFUSED = "This subscription can't be withdrawn."
export const WITHDRAW_WINDOW_CLOSED = 'The 14 days to withdraw have passed.'
export const WITHDRAW_ALREADY = 'This account has already withdrawn once.'
export const WITHDRAW_FAILED = "Withdrawing didn't finish. Try again in a moment."
export const MANAGE_APP_STORE = 'Manage in App Store settings'
export const APP_STORE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions'
export const PERIOD_ANNUAL = 'Annual'
export const PERIOD_MONTHLY = 'Monthly'
export const BILLING_PERIOD = 'Billing period'
export const SUBSCRIBE_OFFLINE = 'Subscribing needs a connection.'
export const SUBSCRIBED = "You're on Premium."
export const SUBSCRIBE_FAILED = "Subscribing didn't finish. Try again in a moment."
export const TERMS_OF_USE = 'Terms of Use'
export const PRIVACY_POLICY = 'Privacy Policy'
export const TERMS_URL = 'https://crosstune.app/terms'
export const PRIVACY_URL = 'https://crosstune.app/privacy'
export const PREMIUM_PITCH =
  'Your recordings live on our servers, so they play on every device. Premium pays for that.'
export const TRIAL_STORAGE = '100 MB of storage during the trial.'
export const TRIAL_KEEPS = 'Everything you make stays and exports after.'
export const COMPARE_FREE = 'Free'
export const COMPARE_PREMIUM = 'Premium'
export const FEATURE_CATALOG = 'Tunes, lists, links, lyrics'
export const FEATURE_SYNC = 'Sync and export'
export const FEATURE_RECORD = 'Record and upload'
export const FEATURE_PLAY = 'Play recordings'
export const FEATURE_PRACTICE = 'Practice: speed, pitch, loops'
export const FEATURE_SCANS = 'Scans'
export const FEATURE_STORAGE = 'Storage'
export const STORAGE_PREMIUM = '3 GB'
export const ON_PREMIUM = "You're on Premium"
export const THANKS = 'Thanks for keeping Crosstune going.'
export const RENEWS = 'Renews'
export const ENDS = 'Ends'
export const COMP_GRANT = 'Premium from Crosstune'
export const INCLUDED = "What's included"
export const INCLUDED_RECORD = 'Record and upload'
export const INCLUDED_RECORD_DETAIL = 'From any device, saved to your tunes'
export const INCLUDED_EVERY_DEVICE = 'Recordings on every device'
export const INCLUDED_EVERY_DEVICE_DETAIL = 'Stored on our servers, 3 GB'
export const INCLUDED_PRACTICE = 'Practice mode'
export const INCLUDED_PRACTICE_DETAIL = 'Speed, pitch, and loops'
export const INCLUDED_SCANS = 'Scans'
export const INCLUDED_SCANS_DETAIL = 'Up to 20 pages a tune'
export const COMPARE_PLANS = 'Compare plans'

/** When the withdrawal window closes. The time is shown since the row hides at that instant. */
export function withdrawUntil(date: Date): string {
  const iso = date.toISOString()
  return `Available until ${addedDay(iso)}, ${recordedTime(iso)}`
}

/** The badge on the annual plan. */
export function save(percent: number): string {
  return `Save ${percent}%`
}

/**
 * How much the annual price saves against twelve monthly ones, as a whole percent, from the
 * store's micro amounts. Null when it saves less than one percent.
 */
export function saving(annualMicros: number, monthlyMicros: number): number | null {
  if (monthlyMicros <= 0) return null
  const yearOfMonths = monthlyMicros * 12
  const percent = Math.round((100 * (yearOfMonths - annualMicros)) / yearOfMonths)
  return percent >= 1 ? percent : null
}

/** An annual plan's price as RevenueCat formats it, per year. */
export function annualPrice(price: string): string {
  return `${price} a year`
}

export const WITHDRAWAL_TERMS = 'You can withdraw within 14 days for a full refund.'
/** The part every renewal disclosure shares, whatever its price, period, or withdrawal. */
export const RENEWS_UNTIL_CANCELLED = 'renewing automatically until you cancel.'

/**
 * The auto-renewal disclosure shown beside the buy button for the selected period. The
 * withdrawal is offered only while the account has not used it, since each account gets one.
 */
export function renewalTerms(price: string, period: PurchasePeriod, withdrawable: boolean): string {
  const unit = period === 'annual' ? 'year' : 'month'
  const terms = `${price} a ${unit}, ${RENEWS_UNTIL_CANCELLED} Cancel anytime with ${MANAGE_SUBSCRIPTION}, before the renewal date.`
  return withdrawable ? `${terms} ${WITHDRAWAL_TERMS}` : terms
}

/** A monthly plan's price as RevenueCat formats it, per month. */
export function monthlyPrice(price: string): string {
  return `${price} a month`
}

/** Local calendar days from `now` to `endsAt`: 0 on the day itself, negative after it. */
export function calendarDaysLeft(endsAt: Date, now: Date): number {
  return localDaysBetween(now, endsAt)
}

/** What is left of the trial in local calendar days, or that it ends today. */
export function trialDaysLeft(endsAt: Date, now: Date): string {
  const days = calendarDaysLeft(endsAt, now)
  if (days <= 0) return TRIAL_ENDS_TODAY
  return `${days} ${days === 1 ? 'day' : 'days'} left`
}

/** The day the trial ends. */
export function trialEnds(endsAt: Date): string {
  return `Ends ${addedDay(endsAt.toISOString())}`
}

/** The trial's end and what is left of it, counted in local calendar days. */
export function trialLeft(endsAt: Date, now: Date): string {
  if (calendarDaysLeft(endsAt, now) <= 0) return TRIAL_ENDS_TODAY
  return `${trialEnds(endsAt)}, ${trialDaysLeft(endsAt, now)}`
}
