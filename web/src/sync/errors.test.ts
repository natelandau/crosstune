import { describe, expect, it } from 'vitest'
import { ApiError, NetworkError, NoTokenError } from '../api/client'
import { isAuthFailure } from './errors'

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
