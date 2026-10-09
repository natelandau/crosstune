export type CountBucket = '0' | '1-9' | '10-49' | '50-199' | '200+'
export type DurationBucket = '<30s' | '30s-2m' | '2-5m' | '5m+'
export type ListenedBucket = '<10s' | '10-30s' | '30s-2m' | '2-5m' | '5m+'
export type BytesBucket = '0' | '<10MB' | '10-50MB' | '50-500MB' | '500MB+'
export type SpeedBucket = '<0.75' | '0.75-0.99' | '1' | '>1'

const MEGABYTE = 1_000_000

export function countBucket(n: number): CountBucket {
  if (n <= 0) return '0'
  if (n < 10) return '1-9'
  if (n < 50) return '10-49'
  if (n < 200) return '50-199'
  return '200+'
}

export function durationBucket(ms: number): DurationBucket {
  if (ms < 30_000) return '<30s'
  if (ms < 120_000) return '30s-2m'
  if (ms < 300_000) return '2-5m'
  return '5m+'
}

// Finer at the low end than durations, since a skip ends a play within seconds.
export function listenedBucket(ms: number): ListenedBucket {
  if (ms < 10_000) return '<10s'
  if (ms < 30_000) return '10-30s'
  if (ms < 120_000) return '30s-2m'
  if (ms < 300_000) return '2-5m'
  return '5m+'
}

// Decimal megabytes, as the system shows a file's size.
export function bytesBucket(bytes: number): BytesBucket {
  if (bytes <= 0) return '0'
  if (bytes < 10 * MEGABYTE) return '<10MB'
  if (bytes < 50 * MEGABYTE) return '10-50MB'
  if (bytes < 500 * MEGABYTE) return '50-500MB'
  return '500MB+'
}

// A rate within a hair of 1 is normal speed, so arithmetic on a stepped rate still lands there.
export function speedBucket(rate: number): SpeedBucket {
  if (Math.abs(rate - 1) < 0.001) return '1'
  if (rate < 0.75) return '<0.75'
  if (rate < 1) return '0.75-0.99'
  return '>1'
}
