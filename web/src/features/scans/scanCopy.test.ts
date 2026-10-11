import { describe, expect, it } from 'vitest'
import { SCAN_REFUSED_ERROR, SCAN_STORAGE_FULL_ERROR, SCAN_TUNE_ONLY_ERROR } from '../../db/scans'
import {
  SCAN_NOT_UPLOADED,
  SCAN_REFUSED,
  SCAN_STORAGE_FULL,
  SCAN_TUNE_ONLY,
  scanErrorLabel,
} from './scanCopy'

describe('scanErrorLabel', () => {
  it.each([
    ['captured', SCAN_STORAGE_FULL_ERROR, SCAN_STORAGE_FULL],
    ['captured', SCAN_REFUSED_ERROR, SCAN_REFUSED],
    ['captured', SCAN_TUNE_ONLY_ERROR, SCAN_TUNE_ONLY],
    ['captured', 'HTTP 413: File too large', SCAN_NOT_UPLOADED],
    ['captured', '', null],
    ['captured', null, null],
    ['downloaded', 'HTTP 500', null],
  ] as const)('labels a %s file with error %j', (origin, error, label) => {
    expect(scanErrorLabel({ origin, error })).toBe(label)
  })
})
