import { planMode, type Plan } from '../../billing/plan'
import { addedDay } from '../../text/format'
import { COMP_GRANT, ENDS, RENEWS } from './planCopy'

export interface Membership {
  label: string
  /** Empty when the label stands alone, as a comp's grant with no end does. */
  value: string
}

/**
 * The membership card's row: a comp's grant, or when a grant renews or ends. Null for a plan the
 * sheet sells to, or a paid grant with no date.
 */
export function membership(plan: Plan): Membership | null {
  if (planMode(plan) !== 'member') return null
  const end = plan.premiumEndsAt
  switch (plan.source) {
    case 'comp':
      return end ? { label: ENDS, value: day(end) } : { label: COMP_GRANT, value: '' }
    case 'apple':
    case 'stripe':
      return end ? { label: plan.autoRenews ? RENEWS : ENDS, value: day(end) } : null
    default:
      return null
  }
}

function day(date: Date): string {
  return addedDay(date.toISOString())
}

/** Where a member manages what they pay for, or null when this app has nowhere to send them. */
export type Manage = { kind: 'portal'; url: string } | { kind: 'appStore' }

export function manage(plan: Plan, portalUrl: string): Manage | null {
  if (plan.source === 'stripe' && portalUrl) return { kind: 'portal', url: portalUrl }
  if (plan.source === 'apple') return { kind: 'appStore' }
  return null
}
