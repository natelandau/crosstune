import { describe, expect, it } from 'vitest'
import { addDays } from './calendar'
import { dayDetail, onThisDayLine, scansLine, weekMonthLabels } from './copy'
import type { Day } from './types'

describe('weekMonthLabels', () => {
  it('labels the week holding each 1st and leaves the rest blank', () => {
    const days = Array.from({ length: 35 }, (_, i) => ({ date: addDays('2026-08-30', i) }))
    expect(weekMonthLabels(days)).toEqual(['Sep', null, null, null, 'Oct'])
  })

  it('labels a partial last week that holds a 1st', () => {
    const days = Array.from({ length: 26 }, (_, i) => ({ date: addDays('2026-09-06', i) }))
    expect(weekMonthLabels(days)).toEqual([null, null, null, 'Oct'])
  })
})

describe('scansLine', () => {
  it('counts scans and the tunes holding them, singular at one', () => {
    expect(scansLine(86, 41)).toBe('86 scans across 41 tunes')
    expect(scansLine(1, 1)).toBe('1 scan across 1 tune')
  })
})

describe('dayDetail', () => {
  const day: Day = {
    date: '2026-03-14',
    music_ms: 0,
    plays: 12,
    practice_sessions: 2,
    scan_views: 3,
    tunes_added: 3,
    recordings: 0,
    status_changes: 0,
    level: 2,
  }

  it('puts scans viewed after practice sessions and before tunes added', () => {
    expect(dayDetail(day, '2026-10-04')).toBe(
      'Mar 14 · 12 plays · 2 practice sessions · 3 scans viewed · 3 tunes added',
    )
  })

  it('reads one scan viewed in the singular and leaves out a day without any', () => {
    expect(
      dayDetail(
        { ...day, plays: 0, practice_sessions: 0, scan_views: 1, tunes_added: 0 },
        '2026-10-04',
      ),
    ).toBe('Mar 14 · 1 scan viewed')
    expect(dayDetail({ ...day, scan_views: 0 }, '2026-10-04')).not.toContain('scan')
  })
})

describe('onThisDayLine', () => {
  it('says a recording was added, since it counts on the day it was added', () => {
    const line = { kind: 'recording' as const, id: 'r1', years: 1 }
    expect(onThisDayLine(line, 'Cluck Old Hen')).toBe(
      'One year ago you added a recording of Cluck Old Hen',
    )
    expect(onThisDayLine({ ...line, years: 3 }, 'Cluck Old Hen')).toBe(
      '3 years ago you added a recording of Cluck Old Hen',
    )
    expect(onThisDayLine(line, null)).toBe('One year ago you added a recording')
  })
})
