import { expect, it } from 'vitest'
import { distanceUnits, formatDistance } from './distance'

it('shows feet to the nearest 10 under a tenth of a mile', () => {
  expect(formatDistance(12, 'en-US')).toBe('40 ft')
  expect(formatDistance(1, 'en-US')).toBe('10 ft')
})

it('shows miles with one decimal from a tenth of a mile', () => {
  expect(formatDistance(300, 'en-US')).toBe('0.2 mi')
  expect(formatDistance(16_093, 'en-US')).toBe('10.0 mi')
})

it('shows meters to the nearest 10 under a kilometer, then kilometers', () => {
  expect(formatDistance(450, 'fr-FR')).toBe('450 m')
  expect(formatDistance(3, 'fr-FR')).toBe('10 m')
  expect(formatDistance(997, 'fr-FR')).toBe('1,0 km')
  expect(formatDistance(2_340, 'fr-FR')).toBe('2,3 km')
})

it('counts in miles and feet in the United Kingdom', () => {
  expect(formatDistance(300, 'en-GB')).toBe('0.2 mi')
  expect(formatDistance(12, 'en-GB')).toBe('40 ft')
})

it("writes numbers with the locale's decimal separator", () => {
  expect(formatDistance(1_200, 'de-DE')).toBe('1,2 km')
  expect(formatDistance(450, 'de-DE')).toBe('450 m')
  expect(formatDistance(1_200, 'en-US')).toBe('0.7 mi')
})

it('uses miles in the United States, the United Kingdom, Liberia, and Myanmar', () => {
  expect(distanceUnits('en-US')).toBe('imperial')
  expect(distanceUnits('en')).toBe('imperial')
  expect(distanceUnits('en-GB')).toBe('imperial')
  expect(distanceUnits('en-LR')).toBe('imperial')
  expect(distanceUnits('my')).toBe('imperial')
  expect(distanceUnits('de-DE')).toBe('metric')
  expect(distanceUnits('fr-CA')).toBe('metric')
  expect(distanceUnits('not a locale')).toBe('metric')
})

it('falls back to plain numbers for a locale it cannot read', () => {
  expect(formatDistance(1_200, 'not a locale')).toBe('1.2 km')
})
