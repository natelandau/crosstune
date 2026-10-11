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
