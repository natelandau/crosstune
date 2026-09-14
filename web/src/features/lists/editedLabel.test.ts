import { describe, expect, it } from 'vitest'
import { editedLabel } from './editedLabel'

function local(year: number, month: number, day: number, hour = 12, minute = 0): Date {
  return new Date(year, month, day, hour, minute)
}

describe('editedLabel', () => {
  const now = local(2026, 8, 13, 0, 5)

  it.each([
    ['earlier today', local(2026, 8, 13, 0, 1), 'Edited today'],
    ['just before midnight', local(2026, 8, 12, 23, 55), 'Edited yesterday'],
    ['two days ago', local(2026, 8, 11), 'Edited Sep 11'],
    ['earlier this year', local(2026, 0, 2), 'Edited Jan 2'],
    ['a prior year', local(2025, 7, 3), 'Edited Aug 3, 2025'],
    ['a clock ahead of this device', local(2026, 8, 13, 9), 'Edited today'],
  ])('reads %s', (_name, edited, label) => {
    expect(editedLabel(edited.toISOString(), now)).toBe(label)
  })

  it('reads yesterday across a year boundary', () => {
    expect(editedLabel(local(2026, 11, 31, 22).toISOString(), local(2027, 0, 1, 8))).toBe(
      'Edited yesterday',
    )
  })

  it('reads today late in the day for an edit just after midnight', () => {
    expect(editedLabel(local(2026, 8, 13, 0, 1).toISOString(), local(2026, 8, 13, 23, 59))).toBe(
      'Edited today',
    )
  })
})
