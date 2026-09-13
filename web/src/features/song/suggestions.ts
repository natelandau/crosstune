import type { TuningField } from '../settings/instruments'

export const KEYS = ['A', 'Bb', 'B', 'C', 'D', 'E', 'F', 'G']

export const VIOLIN_TUNINGS = [
  'Standard (GDAE)',
  'Cross A (AEAE)',
  'Cross G (GDGD)',
  'Calico (AEAC#)',
  'Dead Man (DDAD)',
]

export const BANJO_TUNINGS = [
  'Open G (gDGBD)',
  'Standard C (gCGBD)',
  'Double C (gCGCD)',
  'Sawmill (gDGCD)',
  'Double D (aDADE)',
]

export const TUNING_SUGGESTIONS: Record<TuningField, string[]> = {
  violin_tuning: VIOLIN_TUNINGS,
  banjo_tuning: BANJO_TUNINGS,
}

export const GENRES = ['Old-time', 'Bluegrass', 'Irish', 'Cajun', 'Gospel', 'Blues', 'Swing']

export const FEELS = [
  'Breakdown',
  'Waltz',
  'Rag',
  'Jig',
  'Reel',
  'Hornpipe',
  'March',
  'Song',
  'Slow',
]

export const PART_STRUCTURES = ['AABB', 'AABBCC', 'AB', 'ABC', 'AAB', 'ABB']
