import { describe, expect, it } from 'vitest'
import { entitlementRow } from '../test/rows'
import {
  dueNotice,
  nextPlanChange,
  OFFLINE_LEEWAY_MS,
  planFrom,
  recordingsPlayable,
  scanOpens,
  scanTuneId,
  TRIAL_REMINDER_MS,
} from './plan'

const NOW = new Date('2026-10-10T12:00:00.000Z')
const DAY = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString()
const at = (offsetMs: number) => iso(NOW.getTime() + offsetMs)

describe('planFrom', () => {
  it('is unknown with no row, and gates nothing', () => {
    const plan = planFrom(null, NOW)
    expect(plan.kind).toBe('unknown')
    expect(plan.quotaBytes).toBeNull()
    expect(plan.scansOnly).toBe(false)
    expect(planFrom(undefined, NOW).kind).toBe('unknown')
    expect(recordingsPlayable(plan)).toBe(true)
  })

  it('is premium during a trial, with the premium quota', () => {
    const plan = planFrom(
      entitlementRow({
        premium_source: 'trial',
        premium_expires_at: at(DAY),
        trial_ends_at: at(DAY),
      }),
      NOW,
    )
    expect(plan).toMatchObject({
      kind: 'premium',
      source: 'trial',
      quotaBytes: 10_000,
      scansOnly: false,
      premiumEndsAt: new Date(at(DAY)),
      trialEndsAt: new Date(at(DAY)),
    })
  })

  it('is free once a trial expired a second ago, with the free quota counting scans only', () => {
    const plan = planFrom(
      entitlementRow({ premium_source: 'trial', premium_expires_at: at(-1000) }),
      NOW,
    )
    expect(plan).toMatchObject({ kind: 'free', source: null, quotaBytes: 1_000, scansOnly: true })
    expect(recordingsPlayable(plan)).toBe(false)
  })

  it('is free at the very instant a grant expires', () => {
    expect(
      planFrom(
        entitlementRow({ premium_source: 'stripe', premium_expires_at: iso(NOW.getTime()) }),
        NOW,
      ).kind,
    ).toBe('free')
  })

  it('keeps an auto-renewing grant premium for 7 days past its expiry, judged by the device clock', () => {
    const grant = (daysAgo: number) =>
      entitlementRow({
        premium_source: 'apple',
        auto_renews: true,
        premium_expires_at: at(-daysAgo * DAY),
      })
    expect(planFrom(grant(3), NOW).kind).toBe('premium')
    expect(planFrom(grant(8), NOW).kind).toBe('free')
    expect(planFrom(grant(7), NOW).kind).toBe('free')
    expect(OFFLINE_LEEWAY_MS).toBe(7 * DAY)
  })

  it('gives a grant that does not auto-renew no leeway', () => {
    const row = entitlementRow({ premium_source: 'stripe', premium_expires_at: at(-DAY) })
    expect(planFrom(row, NOW).kind).toBe('free')
  })

  it('is premium for a comp with no expiry', () => {
    const plan = planFrom(entitlementRow({ premium_source: 'comp' }), NOW)
    expect(plan).toMatchObject({ kind: 'premium', source: 'comp', premiumEndsAt: null })
  })

  it('is free with no premium source', () => {
    expect(planFrom(entitlementRow(), NOW).kind).toBe('free')
  })
})

describe('scanTuneId', () => {
  const scan = (
    id: string,
    tune_id: string,
    created_at: string,
    deleted_at: string | null = null,
  ) => ({
    id,
    tune_id,
    created_at,
    deleted_at,
  })

  it('picks the tune of the earliest live scan', () => {
    expect(
      scanTuneId([
        scan('b', 'tune-b', '2026-02-01T00:00:00.000Z'),
        scan('a', 'tune-a', '2026-01-01T00:00:00.000Z'),
      ]),
    ).toBe('tune-a')
  })

  it('breaks a created_at tie by id', () => {
    expect(
      scanTuneId([
        scan('b', 'tune-b', '2026-01-01T00:00:00.000Z'),
        scan('a', 'tune-a', '2026-01-01T00:00:00.000Z'),
      ]),
    ).toBe('tune-a')
  })

  it('ignores deleted scans', () => {
    expect(
      scanTuneId([
        scan('a', 'tune-a', '2026-01-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'),
        scan('b', 'tune-b', '2026-02-01T00:00:00.000Z'),
      ]),
    ).toBe('tune-b')
  })

  it('leaves out the scans in the excluded set', () => {
    expect(
      scanTuneId(
        [
          scan('a', 'tune-a', '2026-01-01T00:00:00.000Z'),
          scan('b', 'tune-b', '2026-02-01T00:00:00.000Z'),
        ],
        new Set(['a']),
      ),
    ).toBe('tune-b')
  })

  it('is null with no live scan', () => {
    expect(scanTuneId([])).toBeNull()
    expect(
      scanTuneId([scan('a', 'tune-a', '2026-01-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z')]),
    ).toBeNull()
  })
})

describe('scanOpens', () => {
  const free = planFrom(entitlementRow(), NOW)
  const premium = planFrom(entitlementRow({ premium_source: 'comp' }), NOW)

  it('opens any scan for premium and for an unknown plan', () => {
    expect(scanOpens(premium, 'tune-b', 'tune-a')).toBe(true)
    expect(scanOpens(planFrom(null, NOW), 'tune-b', 'tune-a')).toBe(true)
  })

  it('opens only the scan tune on free, or any tune while there is no scan tune', () => {
    expect(scanOpens(free, 'tune-a', 'tune-a')).toBe(true)
    expect(scanOpens(free, 'tune-b', 'tune-a')).toBe(false)
    expect(scanOpens(free, 'tune-b', null)).toBe(true)
  })
})

describe('dueNotice', () => {
  it('is trial_ended for a free account whose trial has ended and was not seen', () => {
    const row = entitlementRow({ trial_ends_at: at(-1000) })
    expect(dueNotice(row, NOW, false)).toBe('trial_ended')
    expect(dueNotice({ ...row, trial_end_seen_at: at(-500) }, NOW, false)).toBeNull()
  })

  it('is trial_reminder inside the last three days of a trial', () => {
    const row = entitlementRow({
      premium_source: 'trial',
      premium_expires_at: at(2 * DAY),
      trial_ends_at: at(2 * DAY),
    })
    expect(dueNotice(row, NOW, false)).toBe('trial_reminder')
    expect(dueNotice({ ...row, trial_reminder_seen_at: at(-500) }, NOW, false)).toBeNull()
    const early = { ...row, premium_expires_at: at(4 * DAY), trial_ends_at: at(4 * DAY) }
    expect(dueNotice(early, NOW, false)).toBeNull()
    expect(TRIAL_REMINDER_MS).toBe(3 * DAY)
  })

  it('is first_recording for a trial that holds a recording', () => {
    const row = entitlementRow({
      premium_source: 'trial',
      premium_expires_at: at(10 * DAY),
      trial_ends_at: at(10 * DAY),
    })
    expect(dueNotice(row, NOW, false)).toBeNull()
    expect(dueNotice(row, NOW, true)).toBe('first_recording')
    expect(dueNotice({ ...row, recording_notice_seen_at: at(-500) }, NOW, true)).toBeNull()
  })

  it('is trial_ended for a lapsed trial whose source is still trial', () => {
    const row = entitlementRow({
      premium_source: 'trial',
      premium_expires_at: at(-1000),
      trial_ends_at: at(-1000),
    })
    expect(dueNotice(row, NOW, true)).toBe('trial_ended')
  })

  it('shows a lapsed purchase no trial_ended notice', () => {
    const row = entitlementRow({
      premium_source: 'apple',
      auto_renews: true,
      premium_expires_at: at(-9 * DAY),
      trial_ends_at: at(-30 * DAY),
    })
    expect(planFrom(row, NOW).kind).toBe('free')
    expect(dueNotice(row, NOW, true)).toBeNull()
  })

  it('puts the reminder before first_recording', () => {
    const row = entitlementRow({
      premium_source: 'trial',
      premium_expires_at: at(DAY),
      trial_ends_at: at(DAY),
    })
    expect(dueNotice(row, NOW, true)).toBe('trial_reminder')
  })

  it('puts trial_ended before the others', () => {
    const row = entitlementRow({ trial_ends_at: at(-DAY) })
    expect(dueNotice(row, NOW, true)).toBe('trial_ended')
  })

  it('shows a comp or a purchase no notice', () => {
    const comp = entitlementRow({ premium_source: 'comp', trial_ends_at: at(-DAY) })
    expect(dueNotice(comp, NOW, true)).toBeNull()
    const bought = entitlementRow({
      premium_source: 'stripe',
      premium_expires_at: at(DAY),
      trial_ends_at: at(DAY),
    })
    expect(dueNotice(bought, NOW, true)).toBeNull()
    expect(dueNotice(null, NOW, true)).toBeNull()
  })
})

describe('nextPlanChange', () => {
  it('is null with no row, a comp, or nothing ahead', () => {
    expect(nextPlanChange(null, NOW)).toBeNull()
    expect(nextPlanChange(entitlementRow({ premium_source: 'comp' }), NOW)).toBeNull()
    expect(nextPlanChange(entitlementRow({ trial_ends_at: at(-DAY) }), NOW)).toBeNull()
  })

  it('is the expiry plus the leeway for an auto-renewing grant', () => {
    const row = entitlementRow({
      premium_source: 'apple',
      auto_renews: true,
      premium_expires_at: at(-3 * DAY),
    })
    expect(nextPlanChange(row, NOW)).toEqual(new Date(at(4 * DAY)))
  })

  it('is the expiry for a grant that does not renew', () => {
    const row = entitlementRow({ premium_source: 'stripe', premium_expires_at: at(2 * DAY) })
    expect(nextPlanChange(row, NOW)).toEqual(new Date(at(2 * DAY)))
  })

  it('has no trial instant for a comp with a future trial end', () => {
    const row = entitlementRow({ premium_source: 'comp', trial_ends_at: at(5 * DAY) })
    expect(nextPlanChange(row, NOW)).toBeNull()
  })

  it('is the reminder start for a trial more than three days out', () => {
    const row = entitlementRow({
      premium_source: 'trial',
      premium_expires_at: at(5 * DAY),
      trial_ends_at: at(5 * DAY),
    })
    expect(nextPlanChange(row, NOW)).toEqual(new Date(at(2 * DAY)))
  })

  it('is the trial end once inside the reminder window', () => {
    const row = entitlementRow({
      premium_source: 'trial',
      premium_expires_at: at(DAY),
      trial_ends_at: at(DAY),
    })
    expect(nextPlanChange(row, NOW)).toEqual(new Date(at(DAY)))
  })

  it('changes the answer of planFrom and dueNotice exactly at the instant it returns', () => {
    const row = entitlementRow({
      premium_source: 'trial',
      premium_expires_at: at(5 * DAY),
      trial_ends_at: at(5 * DAY),
    })
    const change = nextPlanChange(row, NOW)!
    const before = new Date(change.getTime() - 1)
    expect(dueNotice(row, before, false)).toBeNull()
    expect(dueNotice(row, change, false)).toBe('trial_reminder')
  })
})
