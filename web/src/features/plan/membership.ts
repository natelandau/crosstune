import { planMode, type Plan } from '../../billing/plan'
import { addedDay } from '../../text/format'
import { COMP_GRANT, ENDS, RENEWS } from './planCopy'

export interface Membership {
  label: string
  /** Empty when the label shows by itself, as a comp's grant with no end does. */
  value: string
}

/**
 * The membership card's row: a comp's grant, or when a grant renews or ends. Null for a plan the
 * sheet sells to, or a paid grant with no date. A renewing grant past its reported expiry is in
 * its offline leeway, where the next renewal is unknown until a sync, so it shows no date.
 */
export function membership(plan: Plan, now: Date): Membership | null {
  if (planMode(plan) !== 'member') return null
  const end = plan.premiumEndsAt
  switch (plan.source) {
    case 'comp':
      return end ? { label: ENDS, value: day(end) } : { label: COMP_GRANT, value: '' }
    case 'apple':
    case 'stripe':
      if (!end || (plan.autoRenews && end <= now)) return null
      return { label: plan.autoRenews ? RENEWS : ENDS, value: day(end) }
    default:
      return null
  }
}

function day(date: Date): string {
  return addedDay(date.toISOString())
}

/** Where a member manages something they pay for. */
export type Manage = { kind: 'portal'; url: string } | { kind: 'appStore' }

/** One place per store still billing the account, skipping one this app has nowhere to send. */
export function manage(plan: Plan, portalUrl: string): Manage[] {
  return plan.paidSources.flatMap((source): Manage[] => {
    if (source === 'apple') return [{ kind: 'appStore' }]
    return portalUrl ? [{ kind: 'portal', url: portalUrl }] : []
  })
}
