import { describe, expect, it } from 'vitest'
import { planFrom } from '../../billing/plan'
import type { LocalEntitlement } from '../../db/types'
import { entitlementRow } from '../../test/rows'
import { addedDay } from '../../text/format'
import { manage, membership } from './membership'
import { COMP_GRANT, ENDS, RENEWS } from './planCopy'

const NOW = new Date('2026-10-10T12:00:00.000Z')
const RENEWAL = '2026-11-10T12:00:00.000Z'
const PORTAL = 'https://billing.example.com/portal'
const plan = (row: Partial<LocalEntitlement>) => planFrom(entitlementRow(row), NOW)

describe('membership', () => {
  it('says when a store grant renews or ends', () => {
    expect(
      membership(
        plan({ premium_source: 'stripe', premium_expires_at: RENEWAL, auto_renews: true }),
        NOW,
      ),
    ).toEqual({ label: RENEWS, value: addedDay(RENEWAL) })
    expect(
      membership(
        plan({ premium_source: 'apple', premium_expires_at: RENEWAL, auto_renews: false }),
        NOW,
      ),
    ).toEqual({ label: ENDS, value: addedDay(RENEWAL) })
  })

  it('names a comp grant by itself, and says when one with an end ends', () => {
    expect(membership(plan({ premium_source: 'comp' }), NOW)).toEqual({
      label: COMP_GRANT,
      value: '',
    })
    expect(membership(plan({ premium_source: 'comp', premium_expires_at: RENEWAL }), NOW)).toEqual({
      label: ENDS,
      value: addedDay(RENEWAL),
    })
  })

  it('shows nothing for a plan the sheet sells to', () => {
    expect(membership(plan({}), NOW)).toBeNull()
  })
})

describe('manage', () => {
  const grant = (source: 'apple' | 'stripe') => ({ source, expires_at: RENEWAL, auto_renews: true })

  it('sends a member to each store still billing them', () => {
    const both = plan({ premium_source: 'comp', paid_grants: [grant('apple'), grant('stripe')] })
    expect(manage(both, PORTAL)).toEqual([{ kind: 'appStore' }, { kind: 'portal', url: PORTAL }])
  })

  it('offers no portal this build has nowhere to send', () => {
    const stripe = plan({
      premium_source: 'stripe',
      premium_expires_at: RENEWAL,
      auto_renews: true,
    })
    expect(manage(stripe, PORTAL)).toEqual([{ kind: 'portal', url: PORTAL }])
    expect(manage(stripe, '')).toEqual([])
  })

  it('offers nothing to manage on a comp no store bills', () => {
    expect(manage(plan({ premium_source: 'comp' }), PORTAL)).toEqual([])
  })
})
