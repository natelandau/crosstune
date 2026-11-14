import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addedDay } from '../../text/format'
import {
  RECORDINGS_COST,
  SUBSCRIBE_OR_EXPORT,
  LAPSED_PREMIUM_TITLE,
  LAPSED_TRIAL_TITLE,
  MANAGE_SUBSCRIPTION,
  PREMIUM_PITCH,
  PREMIUM_PLAN_TITLE,
  PREMIUM_RECORDINGS_TITLE,
  PREMIUM_SCANS_BODY,
  PREMIUM_SCANS_TITLE,
  planContext,
  renewalTerms,
  save,
  saving,
  TRIAL_ENDS_TODAY,
  trialDaysLeft,
  trialEnds,
  trialEndsLine,
  trialLeft,
  WITHDRAW_LABEL,
  withdrawUntil,
} from './planCopy'

const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute)

describe('trialLeft', () => {
  it('counts local calendar days', () => {
    const end = at(15, 9)
    expect(trialLeft(end, at(10, 20))).toBe(`Ends ${addedDay(end.toISOString())}, 5 days left`)
  })

  it('says 1 day left on the day before the end', () => {
    // Under an hour apart, but across midnight.
    const end = at(11, 0, 30)
    expect(trialLeft(end, at(10, 23, 30))).toBe(`Ends ${addedDay(end.toISOString())}, 1 day left`)
  })

  it('says Ends today on the last day, before and after the end instant', () => {
    expect(trialLeft(at(10, 18), at(10, 8))).toBe(TRIAL_ENDS_TODAY)
    expect(trialLeft(at(10, 8), at(10, 18))).toBe(TRIAL_ENDS_TODAY)
  })
})

describe('trialDaysLeft', () => {
  it('counts local calendar days', () => {
    expect(trialDaysLeft(at(15, 9), at(10, 20))).toBe('5 days left')
  })

  it('says 1 day left across midnight, under an hour from the end', () => {
    expect(trialDaysLeft(at(11, 0, 30), at(10, 23, 30))).toBe('1 day left')
  })

  it('says Ends today on the last day and after it', () => {
    expect(trialDaysLeft(at(10, 18), at(10, 8))).toBe(TRIAL_ENDS_TODAY)
    expect(trialDaysLeft(at(10, 8), at(10, 18))).toBe(TRIAL_ENDS_TODAY)
    expect(trialDaysLeft(at(9, 8), at(10, 18))).toBe(TRIAL_ENDS_TODAY)
  })
})

describe('trialEnds', () => {
  it("names the end in the app's day format", () => {
    const end = at(15, 9)
    expect(trialEnds(end)).toBe(`Ends ${addedDay(end.toISOString())}`)
  })

  it('is the first half of trialLeft', () => {
    const end = at(15, 9)
    const now = at(10, 20)
    expect(trialLeft(end, now)).toBe(`${trialEnds(end)}, ${trialDaysLeft(end, now)}`)
  })
})

describe('trialEndsLine', () => {
  it('names the end day, and drops on the last day', () => {
    const end = at(15, 9)
    expect(trialEndsLine(end, at(14, 20))).toBe(trialEnds(end))
    expect(trialEndsLine(end, at(15, 8))).toBeNull()
  })
})

describe('planContext', () => {
  const band = { recordingId: 'r1' }
  // The line asks to subscribe or export only when the sheet offers an export.
  const asks = `${RECORDINGS_COST} ${SUBSCRIBE_OR_EXPORT}`

  it.each([
    ['recordings', 'paid', 12, null, LAPSED_PREMIUM_TITLE, asks, 'export_all'],
    ['recordings', 'trial', 1, null, LAPSED_TRIAL_TITLE, asks, 'export_all'],
    ['recordings', 'paid', 12, band, LAPSED_PREMIUM_TITLE, asks, 'export_recording'],
    ['recordings', 'trial', 0, band, LAPSED_TRIAL_TITLE, asks, 'export_recording'],
    ['recordings', 'trial', 0, null, LAPSED_TRIAL_TITLE, RECORDINGS_COST, null],
    ['recordings', 'paid', 0, null, LAPSED_PREMIUM_TITLE, RECORDINGS_COST, null],
    ['recordings', null, 0, null, PREMIUM_RECORDINGS_TITLE, RECORDINGS_COST, null],
    ['recordings', null, 5, null, PREMIUM_RECORDINGS_TITLE, asks, 'export_all'],
    ['recordings', null, 5, band, PREMIUM_RECORDINGS_TITLE, asks, 'export_recording'],
    ['recordings', null, 0, band, PREMIUM_RECORDINGS_TITLE, RECORDINGS_COST, null],
    ['scans', 'paid', 3, null, LAPSED_PREMIUM_TITLE, PREMIUM_SCANS_BODY, null],
    ['scans', 'trial', 3, null, LAPSED_TRIAL_TITLE, PREMIUM_SCANS_BODY, null],
    ['scans', null, 3, null, PREMIUM_SCANS_TITLE, PREMIUM_SCANS_BODY, null],
    ['plan', null, 0, null, PREMIUM_PLAN_TITLE, PREMIUM_PITCH, null],
    ['plan', 'paid', 12, null, PREMIUM_PLAN_TITLE, PREMIUM_PITCH, null],
    ['plan', 'trial', 0, null, PREMIUM_PLAN_TITLE, PREMIUM_PITCH, null],
  ] as const)(
    '%s, lapse %s, %s recordings, subject %j',
    (reason, lapse, count, subject, title, body, action) => {
      expect(planContext({ reason, lapse, recordingCount: count, subject })).toEqual({
        title,
        body,
        action,
      })
    },
  )
})

describe('saving', () => {
  it('saves 17 percent on the store prices', () => {
    expect(saving(49_990_000, 4_990_000)).toBe(17)
  })

  it('is null when the annual price saves less than a percent', () => {
    expect(saving(59_880_000, 4_990_000)).toBeNull()
    expect(saving(70_000_000, 4_990_000)).toBeNull()
  })

  it('rounds to the nearest whole percent', () => {
    // Against twelve months at 10: 114 saves 5%, 114.6 saves 4.5%, which rounds up, and 114.61
    // saves 4.49%.
    expect(saving(114_000_000, 10_000_000)).toBe(5)
    expect(saving(114_600_000, 10_000_000)).toBe(5)
    expect(saving(114_610_000, 10_000_000)).toBe(4)
    // Half a percent rounds up to the one percent the badge needs; under it shows nothing.
    expect(saving(119_400_000, 10_000_000)).toBe(1)
    expect(saving(119_410_000, 10_000_000)).toBeNull()
  })

  it('is null against a free or negative month', () => {
    expect(saving(49_990_000, 0)).toBeNull()
    expect(saving(49_990_000, -4_990_000)).toBeNull()
  })

  it('names the percentage', () => {
    expect(save(17)).toBe('Save 17%')
  })
})

describe('web billing labels', () => {
  it('match the ones the refund emails tell the customer to press', () => {
    const emails = readFileSync(
      resolve(import.meta.dirname, '../../../../api/src/crosstune/billing/emails.py'),
      'utf8',
    )
    expect(emails).toContain(WITHDRAW_LABEL)
    expect(emails).toContain(MANAGE_SUBSCRIPTION)
  })

  it('withdrawUntil names the last day', () => {
    const end = at(24, 9)
    expect(withdrawUntil(end)).toBe(`Available until ${addedDay(end.toISOString())}, 9:00 AM`)
  })
})

describe('renewalTerms', () => {
  it.each([
    ['annual', 'year'],
    ['monthly', 'month'],
  ] as const)('states the price, renewal, cancellation, and withdrawal for %s', (period, unit) => {
    expect(renewalTerms('$9.99', period, true)).toBe(
      `$9.99 a ${unit}, renewing automatically until you cancel. Cancel anytime with Manage subscription, before the renewal date. You can withdraw within 14 days for a full refund.`,
    )
  })

  it('leaves out the withdrawal once the account has used it', () => {
    expect(renewalTerms('$9.99', 'monthly', false)).toBe(
      '$9.99 a month, renewing automatically until you cancel. Cancel anytime with Manage subscription, before the renewal date.',
    )
  })
})
