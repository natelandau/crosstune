import { describe, expect, it } from 'vitest'
import { ApiError, NetworkError, NoTokenError } from '../api/client'
import {
  isAuthFailure,
  isPlanRefusal,
  PREMIUM_REQUIRED_PROBLEM,
  SCAN_TUNE_ONLY_PROBLEM,
} from './errors'

describe('isAuthFailure', () => {
  it('is true for a missing token', () => {
    expect(isAuthFailure(new NoTokenError())).toBe(true)
  })

  it.each([401, 403])('is true for a %d from the API', (status) => {
    expect(isAuthFailure(new ApiError(status, null))).toBe(true)
  })

  it.each([404, 409, 500])('is false for a %d from the API', (status) => {
    expect(isAuthFailure(new ApiError(status, null))).toBe(false)
  })

  it('is false for a network failure', () => {
    expect(isAuthFailure(new NetworkError(new TypeError('x')))).toBe(false)
  })
})

describe('isPlanRefusal', () => {
  const problem = (type: string) => ({ type, title: 't', status: 403, detail: 'd' })

  it.each([PREMIUM_REQUIRED_PROBLEM, SCAN_TUNE_ONLY_PROBLEM])('is true for a 403 %s', (type) => {
    expect(isPlanRefusal(new ApiError(403, problem(type)))).toBe(true)
  })

  it('is false for a bare 403 and for another status with the same type', () => {
    expect(isPlanRefusal(new ApiError(403, null))).toBe(false)
    expect(isPlanRefusal(new ApiError(409, problem(PREMIUM_REQUIRED_PROBLEM)))).toBe(false)
  })

  it('is not an auth failure, while a bare 403 still is', () => {
    expect(isAuthFailure(new ApiError(403, problem(PREMIUM_REQUIRED_PROBLEM)))).toBe(false)
    expect(isAuthFailure(new ApiError(403, problem(SCAN_TUNE_ONLY_PROBLEM)))).toBe(false)
    expect(isAuthFailure(new ApiError(403, null))).toBe(true)
  })
})
