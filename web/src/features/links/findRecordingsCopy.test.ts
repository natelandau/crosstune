import { describe, expect, it } from 'vitest'
import { tooManySearches } from './findRecordingsCopy'

describe('tooManySearches', () => {
  it.each([
    [7, 'Too many searches. Try again in 7 seconds.'],
    [1, 'Too many searches. Try again in 1 second.'],
    [0, 'Too many searches. Try again in 1 second.'],
    [-3, 'Too many searches. Try again in 1 second.'],
    [0.2, 'Too many searches. Try again in 1 second.'],
  ])('words a wait of %s', (seconds, message) => {
    expect(tooManySearches(seconds)).toBe(message)
  })
})
