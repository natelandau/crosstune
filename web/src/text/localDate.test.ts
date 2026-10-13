import { describe, expect, it } from 'vitest'
import { localDaysBetween, localIsoDate, localIsoTime } from './localDate'

describe('localDaysBetween', () => {
  it('counts calendar days, not elapsed hours', () => {
    expect(localDaysBetween(new Date(2026, 2, 7, 23, 59), new Date(2026, 2, 8, 0, 1))).toBe(1)
    expect(localDaysBetween(new Date(2026, 2, 8, 0, 1), new Date(2026, 2, 8, 23, 59))).toBe(0)
  })

  it('is negative when the second date is earlier', () => {
    expect(localDaysBetween(new Date(2026, 9, 13), new Date(2026, 9, 10))).toBe(-3)
  })
})

describe('localIsoDate and localIsoTime', () => {
  it('pad each part to two digits', () => {
    const date = new Date(2026, 0, 5, 7, 3)
    expect(localIsoDate(date)).toBe('2026-01-05')
    expect(localIsoTime(date)).toBe('07:03')
  })
})
