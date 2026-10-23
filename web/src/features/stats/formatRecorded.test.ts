import { expect, test } from 'vitest'
import { formatRecorded } from './formatRecorded'

test.each([
  [0, '0 min'],
  [59_999, '0 min'],
  [720_000, '12 min'],
  [3_599_999, '59 min'],
  [3_600_000, '1 h 0 min'],
  [33_120_000, '9 h 12 min'],
])('formatRecorded(%i) is %s', (ms, text) => {
  expect(formatRecorded(ms)).toBe(text)
})
