import { expect, test } from 'vitest'
import { formatRecorded } from './formatRecorded'

test.each([
  [0, '0 m'],
  [59_999, '0 m'],
  [720_000, '12 m'],
  [3_599_999, '59 m'],
  [3_600_000, '1 h 0 m'],
  [33_120_000, '9 h 12 m'],
])('formatRecorded(%i) is %s', (ms, text) => {
  expect(formatRecorded(ms)).toBe(text)
})
