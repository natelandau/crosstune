import { describe, expect, it } from 'vitest'
import { ApiError, NetworkError, NoTokenError, TransferError } from '../api/client'
import { QUOTA_PROBLEM } from '../sync/errors'
import { failureReason, syncFailureReason } from './failure'

const problem = (status: number, type = 'about:blank') => ({
  type,
  title: 't',
  status,
  detail: 'd',
})

describe('failureReason', () => {
  it.each([
    ['a network error', new NetworkError(new TypeError('Failed to fetch')), 'network'],
    ['a quota problem', new ApiError(413, problem(413, QUOTA_PROBLEM)), 'storage_full'],
    ['a browser quota error', new DOMException('full', 'QuotaExceededError'), 'storage_full'],
    ['a 401', new ApiError(401, problem(401)), 'auth_expired'],
    ['a 403', new ApiError(403, problem(403)), 'auth_expired'],
    ['a missing token', new NoTokenError(), 'auth_expired'],
    ['a 500', new ApiError(500, null), 'server_error'],
    ['a 503', new ApiError(503, problem(503)), 'server_error'],
    ['a storage host 502', new TransferError(502), 'server_error'],
    ['a 422', new ApiError(422, problem(422)), 'other'],
    ['a storage host 403', new TransferError(403), 'other'],
    ['an unknown error', new Error('boom'), 'other'],
    ['a non-error', 'boom', 'other'],
  ] as const)('maps %s to %s', (_label, error, reason) => {
    expect(failureReason(error)).toBe(reason)
  })
})

describe('syncFailureReason', () => {
  it.each([
    ['a 401', new ApiError(401, problem(401)), 'auth_expired'],
    ['a missing token', new NoTokenError(), 'auth_expired'],
    ['a 503', new ApiError(503, problem(503)), 'server_error'],
    ['a quota problem', new ApiError(413, problem(413, QUOTA_PROBLEM)), 'other'],
    ['a browser quota error', new DOMException('full', 'QuotaExceededError'), 'other'],
    ['a network error', new NetworkError(new TypeError('x')), 'other'],
  ] as const)('maps %s to %s', (_label, error, reason) => {
    expect(syncFailureReason(error)).toBe(reason)
  })
})
