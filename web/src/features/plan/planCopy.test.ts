import { describe, expect, it } from 'vitest'
import { addedDay } from '../../text/format'
import { save, saving, TRIAL_ENDS_TODAY, trialDaysLeft, trialEnds, trialLeft } from './planCopy'

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
