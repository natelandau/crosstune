import { describe, expect, it } from 'vitest'
import { addedDay } from '../../text/format'
import { premiumUntil, TRIAL_ENDS_TODAY, trialLeft } from './planCopy'

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

describe('premiumUntil', () => {
  it('names the end date', () => {
    const end = at(20, 12)
    expect(premiumUntil(end)).toBe(`Until ${addedDay(end.toISOString())}`)
  })
})
