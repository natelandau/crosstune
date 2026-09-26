import { afterEach, describe, expect, it } from 'vitest'
import {
  clearAccountDeletedNotice,
  forgetUser,
  hasAccountDeletedNotice,
  markAccountDeleted,
  rememberedUser,
  rememberUser,
} from './session'

describe('session', () => {
  afterEach(() => {
    forgetUser()
    clearAccountDeletedNotice()
  })

  it('remembers and forgets the last signed-in user', () => {
    rememberUser('user_1')
    expect(rememberedUser()).toBe('user_1')
    forgetUser()
    expect(rememberedUser()).toBeNull()
  })

  it('marks, reads, and clears the account-deleted notice independently', () => {
    expect(hasAccountDeletedNotice()).toBe(false)
    markAccountDeleted()
    // Reading twice must not consume it, so a StrictMode double render still sees it.
    expect(hasAccountDeletedNotice()).toBe(true)
    expect(hasAccountDeletedNotice()).toBe(true)
    clearAccountDeletedNotice()
    expect(hasAccountDeletedNotice()).toBe(false)
  })
})
