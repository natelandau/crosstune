import type { TuningField } from '../settings/instruments'

/**
 * Every key spelling the client offers, alphabetical, with the sharp before the flat for each
 * letter. F sharp and G flat are one pitch but two keys, and musicians name them separately, so
 * both are listed; `pitchClass` reads them to the same hue, so they still color alike.
 */
export const ALL_KEYS = [
  'A',
  'A#',
  'Ab',
  'B',
  'Bb',
  'C',
  'C#',
  'D',
  'D#',
  'Db',
  'E',
  'Eb',
  'F',
  'F#',
  'G',
  'G#',
  'Gb',
] as const

/**
 * The keys on the grid, reachable in one tap. Everything else in ALL_KEYS costs a second tap
 * under More keys…, so this list is what a player reaches for without thinking. Edit it to
 * change the grid; nothing else needs to change.
 */
export const QUICK_KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'Bb', 'Eb'] as const

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
