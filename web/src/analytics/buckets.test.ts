import { describe, expect, it } from 'vitest'
import { bytesBucket, countBucket, durationBucket, listenedBucket, speedBucket } from './buckets'

describe('buckets', () => {
  it('counts at each edge', () => {
    expect([-1, 0, 1, 9, 10, 49, 50, 199, 200].map(countBucket)).toEqual([
      '0',
      '0',
      '1-9',
      '1-9',
      '10-49',
      '10-49',
      '50-199',
      '50-199',
      '200+',
    ])
  })

  it('durations at each edge, in milliseconds', () => {
    expect([0, 29_999, 30_000, 119_999, 120_000, 299_999, 300_000].map(durationBucket)).toEqual([
      '<30s',
      '<30s',
      '30s-2m',
      '30s-2m',
      '2-5m',
      '2-5m',
      '5m+',
    ])
  })

  it('listened time at each edge, in milliseconds', () => {
    expect(
      [0, 9_999, 10_000, 29_999, 30_000, 119_999, 120_000, 299_999, 300_000].map(listenedBucket),
    ).toEqual(['<10s', '<10s', '10-30s', '10-30s', '30s-2m', '30s-2m', '2-5m', '2-5m', '5m+'])
  })

  it('bytes at each edge, in decimal megabytes', () => {
    const mb = 1_000_000
    expect(
      [-1, 0, 1, 10 * mb - 1, 10 * mb, 50 * mb - 1, 50 * mb, 500 * mb - 1, 500 * mb].map(
        bytesBucket,
      ),
    ).toEqual(['0', '0', '<10MB', '<10MB', '10-50MB', '10-50MB', '50-500MB', '50-500MB', '500MB+'])
  })

  it('speeds, treating a rate within a hair of 1 as normal', () => {
    expect([0.5, 0.74, 0.75, 0.99, 0.9995, 1, 1.0005, 1.25, 2].map(speedBucket)).toEqual([
      '<0.75',
      '<0.75',
      '0.75-0.99',
      '0.75-0.99',
      '1',
      '1',
      '1',
      '>1',
      '>1',
    ])
  })
})
