import { describe, expect, it } from 'vitest'
import { NOTATION_REFUSED_ERROR, NOTATION_STORAGE_FULL_ERROR } from '../../db/notation'
import {
  NOTATION_NOT_UPLOADED,
  NOTATION_REFUSED,
  NOTATION_STORAGE_FULL,
  pageErrorLabel,
} from './notationCopy'

describe('pageErrorLabel', () => {
  it.each([
    ['captured', NOTATION_STORAGE_FULL_ERROR, NOTATION_STORAGE_FULL],
    ['captured', NOTATION_REFUSED_ERROR, NOTATION_REFUSED],
    ['captured', 'HTTP 413: File too large', NOTATION_NOT_UPLOADED],
    ['captured', '', null],
    ['captured', null, null],
    ['downloaded', 'HTTP 500', null],
  ] as const)('labels a %s file with error %j', (origin, error, label) => {
    expect(pageErrorLabel({ origin, error })).toBe(label)
  })
})
