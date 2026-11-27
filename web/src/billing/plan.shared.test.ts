import { expect } from 'vitest'
import type { EntitlementRow } from '../api/types'
import { describeSharedCases, expectSameInstant, loadSharedCases } from '../test/sharedCases'
import { dueNotice, nextPlanChange, planFrom, type Plan } from './plan'

type ExpectedPlan = {
  kind: string
  source: string | null
  premium_ends_at: string | null
  trial_starts_at: string | null
  trial_ends_at: string | null
  quota_bytes: number | null
  auto_renews: boolean
  paid_sources: string[]
  lapse: string | null
}

const cases = loadSharedCases<
  { row: EntitlementRow | null; now: string; holds_recordings: boolean },
  { plan: ExpectedPlan; due_notice: string | null; next_change: string | null }
>(import.meta.glob('../../../fixtures/plan/*.json', { eager: true, import: 'default' }), 'web')

const isoOf = (date: Date | null) => date?.toISOString() ?? null

function wirePlan(plan: Plan): ExpectedPlan {
  return {
    kind: plan.kind,
    source: plan.source,
    premium_ends_at: isoOf(plan.premiumEndsAt),
    trial_starts_at: isoOf(plan.trialStartsAt),
    trial_ends_at: isoOf(plan.trialEndsAt),
    quota_bytes: plan.quotaBytes,
    auto_renews: plan.autoRenews,
    paid_sources: plan.paidSources,
    lapse: plan.lapse,
  }
}

describeSharedCases('premium judgment shared cases', cases, 20, ({ input, expected }) => {
  const now = new Date(input.now)
  const { premium_ends_at, trial_starts_at, trial_ends_at, ...plan } = wirePlan(
    planFrom(input.row, now),
  )
  const {
    premium_ends_at: expectedPremiumEndsAt,
    trial_starts_at: expectedTrialStartsAt,
    trial_ends_at: expectedTrialEndsAt,
    ...expectedPlan
  } = expected.plan
  expect(plan).toEqual(expectedPlan)
  expectSameInstant(premium_ends_at, expectedPremiumEndsAt)
  expectSameInstant(trial_starts_at, expectedTrialStartsAt)
  expectSameInstant(trial_ends_at, expectedTrialEndsAt)
  expect(dueNotice(input.row, now, input.holds_recordings)).toBe(expected.due_notice)
  expectSameInstant(isoOf(nextPlanChange(input.row, now)), expected.next_change)
})
