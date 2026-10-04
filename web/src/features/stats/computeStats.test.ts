import { describe, expect, test } from 'vitest'
import { computeStats } from './computeStats'
import type { Stats, StatsInput } from './types'

interface Fixture {
  input: StatsInput
  expected: Stats
}

// The Swift stats module reads the same files, so both clients agree to the byte.
const fixtures = import.meta.glob<Fixture>('../../../../fixtures/stats/*.json', {
  eager: true,
  import: 'default',
})

describe('computeStats', () => {
  test('finds the shared fixtures', () => {
    expect(Object.keys(fixtures).length).toBeGreaterThanOrEqual(14)
  })

  test.each(Object.entries(fixtures).map(([path, fixture]) => [path.split('/').pop(), fixture]))(
    '%s',
    (_name, { input, expected }) => {
      expect(computeStats(input)).toEqual(expected)
    },
  )
})
