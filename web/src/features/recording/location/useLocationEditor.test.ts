import { expect, it } from 'vitest'
import { openingListFor } from './useLocationEditor'

it('opens on Nearby around a center, waits while one may come, and falls to Saved', () => {
  expect(openingListFor(true, false)).toBe('nearby')
  expect(openingListFor(false, true)).toBeNull()
  expect(openingListFor(false, false)).toBe('saved')
})
