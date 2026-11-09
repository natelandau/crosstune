import { describe, expect, it } from 'vitest'
import { planFrom } from '../../billing/plan'
import type { StoreOffer } from '../../billing/store'
import { entitlementRow } from '../../test/rows'
import type { Offers } from './useOffers'
import { annualSaving, canWithdraw, chosenPeriod, purchaseOptionsFor } from './planSheetModel'

const NOW = new Date('2026-10-10T12:00:00.000Z')
const ANNUAL: StoreOffer = { period: 'annual', price: '$49.99', amountMicros: 49_990_000 }
const MONTHLY: StoreOffer = { period: 'monthly', price: '$4.99', amountMicros: 4_990_000 }
const FREE = planFrom(entitlementRow({}), NOW)
const READY: Offers = { kind: 'ready', offers: [ANNUAL, MONTHLY] }

describe('purchaseOptionsFor', () => {
  const options = (patch: Partial<Parameters<typeof purchaseOptionsFor>[0]>) =>
    purchaseOptionsFor({
      hasStore: true,
      plan: FREE,
      online: true,
      offers: READY,
      settled: false,
      ...patch,
    }).kind

  it('offers the store’s periods to a free account online', () => {
    expect(
      purchaseOptionsFor({
        hasStore: true,
        plan: FREE,
        online: true,
        offers: READY,
        settled: false,
      }),
    ).toEqual({
      kind: 'choice',
      offers: [ANNUAL, MONTHLY],
    })
  })

  it('offers nothing to buy without a store, or to a paid account', () => {
    expect(options({ hasStore: false })).toBe('notPurchasable')
    const paid = planFrom(
      entitlementRow({ premium_source: 'stripe', premium_expires_at: null }),
      NOW,
    )
    expect(options({ plan: paid })).toBe('notPurchasable')
  })

  it('says a settled purchase went through ahead of everything but the store', () => {
    expect(options({ settled: true, online: false })).toBe('subscribed')
  })

  it('says it is offline before asking how the store answered', () => {
    expect(options({ online: false, offers: { kind: 'failed' } })).toBe('offline')
  })

  it('follows the store’s answer', () => {
    expect(options({ offers: { kind: 'failed' } })).toBe('unavailable')
    expect(options({ offers: { kind: 'pending' } })).toBe('pending')
    expect(options({ offers: { kind: 'ready', offers: [] } })).toBe('empty')
  })
})

describe('chosenPeriod and annualSaving', () => {
  it('keeps the period asked for while the store sells it', () => {
    expect(chosenPeriod([ANNUAL, MONTHLY], 'annual')).toBe('annual')
    expect(chosenPeriod([ANNUAL, MONTHLY], 'monthly')).toBe('monthly')
    expect(annualSaving([ANNUAL, MONTHLY])).toBe(17)
  })

  it('chooses the one period sold, with no saving', () => {
    expect(chosenPeriod([MONTHLY], 'annual')).toBe('monthly')
    expect(annualSaving([MONTHLY])).toBeNull()
    expect(annualSaving([ANNUAL])).toBeNull()
  })
})

describe('canWithdraw', () => {
  it('offers the withdrawal until the account has used it', () => {
    expect(canWithdraw(undefined)).toBe(true)
    expect(canWithdraw(entitlementRow({}))).toBe(true)
    expect(canWithdraw(entitlementRow({ withdrawal_used: true }))).toBe(false)
  })
})
