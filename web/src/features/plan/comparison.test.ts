import { expect, it } from 'vitest'
import { COMPARISON } from './comparison'
import { INCLUDED_FEATURES } from './included'
import {
  FEATURE_PRACTICE,
  FEATURE_RECORD,
  FEATURE_SCANS,
  FEATURE_STORAGE,
  INCLUDED_EVERY_DEVICE,
  INCLUDED_PRACTICE,
  INCLUDED_RECORD,
  INCLUDED_SCANS,
} from './planCopy'

it('gives a feature in both lists the same icon in each', () => {
  const comparison = new Map(COMPARISON.map((feature) => [feature.title, feature.icon]))
  const included = new Map(INCLUDED_FEATURES.map((feature) => [feature.title, feature.icon]))
  const overlaps = [
    [FEATURE_RECORD, INCLUDED_RECORD],
    [FEATURE_PRACTICE, INCLUDED_PRACTICE],
    [FEATURE_SCANS, INCLUDED_SCANS],
    [FEATURE_STORAGE, INCLUDED_EVERY_DEVICE],
  ]
  // Every included feature has its comparison row.
  expect(overlaps.map(([, title]) => title).sort()).toEqual([...included.keys()].sort())
  for (const [row, feature] of overlaps) {
    expect(comparison.get(row!)).toBeDefined()
    expect(comparison.get(row!)).toBe(included.get(feature!))
  }
})
