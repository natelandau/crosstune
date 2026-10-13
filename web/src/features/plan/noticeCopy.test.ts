import { describe, expect, it } from 'vitest'
import { daysLeft, subscribeAnnual } from './noticeCopy'
import { TRIAL_ENDS_TODAY } from './planCopy'

describe('noticeCopy', () => {
  it('counts the days left of Premium', () => {
    expect(daysLeft(1)).toBe('1 day left of Premium')
    expect(daysLeft(3)).toBe('3 days left of Premium')
  })

  it('says the trial ends today on its last day', () => {
    expect(daysLeft(0)).toBe(TRIAL_ENDS_TODAY)
    expect(daysLeft(-1)).toBe(TRIAL_ENDS_TODAY)
  })

  it('names the annual price on the subscribe action', () => {
    expect(subscribeAnnual('$49.99')).toBe('Subscribe for $49.99 a year')
  })
})
