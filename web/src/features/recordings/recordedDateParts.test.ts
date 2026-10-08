import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RECORDED_DATE_FUTURE } from '../../commands/messages'
import { datePatch, partsOf } from './recordedDateParts'
import { dayCount, NO_DATE, YEAR_FORMAT } from '../../ui/partialDate'

// West of UTC, a local read of a partial date lands in the period before it.
beforeEach(() => {
  vi.stubEnv('TZ', 'America/Los_Angeles')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-04T12:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('partsOf', () => {
  it('reads a partial date in UTC, west of it', () => {
    // Proves the zone took: local time reads the stored instant as the year before.
    expect(new Date('1937-01-01T00:00:00Z').getFullYear()).toBe(1936)
    expect(partsOf('1937-01-01T00:00:00.000Z', 'year')).toEqual({
      year: '1937',
      month: '',
      day: '',
    })
    expect(partsOf('1998-05-01T00:00:00.000Z', 'month')).toEqual({
      year: '1998',
      month: '5',
      day: '',
    })
    expect(partsOf('1998-10-03T00:00:00.000Z', 'day')).toEqual({
      year: '1998',
      month: '10',
      day: '3',
    })
  })

  it('reads a take as the local day it shows', () => {
    // 01:30 UTC on Oct 4 is still Oct 3 in Los Angeles.
    expect(partsOf('2026-10-04T01:30:00.000Z', 'time')).toEqual({
      year: '2026',
      month: '10',
      day: '3',
    })
  })

  it('reads an unknown date as no parts', () => {
    expect(partsOf(null, null)).toEqual(NO_DATE)
  })
})

describe('datePatch', () => {
  it('stores a year as UTC midnight on Jan 1', () => {
    expect(datePatch({ year: '1937', month: '', day: '' })).toEqual({
      recorded_at: '1937-01-01T00:00:00.000Z',
      recorded_precision: 'year',
    })
  })

  it('stores a month and a day at UTC midnight on their first day', () => {
    expect(datePatch({ year: '1998', month: '5', day: '' })).toEqual({
      recorded_at: '1998-05-01T00:00:00.000Z',
      recorded_precision: 'month',
    })
    expect(datePatch({ year: '1998', month: '10', day: '3' })).toEqual({
      recorded_at: '1998-10-03T00:00:00.000Z',
      recorded_precision: 'day',
    })
  })

  it('reads a blank year as no date, whatever month is left behind it', () => {
    expect(datePatch({ year: '', month: '5', day: '3' })).toEqual({
      recorded_at: null,
      recorded_precision: null,
    })
  })

  it('refuses a year that is not four digits', () => {
    expect(datePatch({ year: '98', month: '', day: '' })).toEqual({ error: YEAR_FORMAT })
    expect(datePatch({ year: '0999', month: '', day: '' })).toEqual({ error: YEAR_FORMAT })
  })

  it('refuses a year after this one and a month not yet begun', () => {
    expect(datePatch({ year: '2027', month: '', day: '' })).toEqual({
      error: RECORDED_DATE_FUTURE,
    })
    expect(datePatch({ year: '2026', month: '12', day: '' })).toEqual({
      error: RECORDED_DATE_FUTURE,
    })
  })
})

describe('dayCount', () => {
  it('ends February at the 29th in a leap year and the 28th otherwise', () => {
    expect(dayCount({ year: '2024', month: '2', day: '' })).toBe(29)
    expect(dayCount({ year: '2023', month: '2', day: '' })).toBe(28)
    expect(dayCount({ year: '1900', month: '2', day: '' })).toBe(28)
  })

  it('offers 31 days while the year is unfinished, and none without a month', () => {
    expect(dayCount({ year: '19', month: '4', day: '31' })).toBe(31)
    expect(dayCount({ year: '1998', month: '', day: '' })).toBe(0)
  })
})
