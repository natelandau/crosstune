import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  APPLE_SCRIPT_URL,
  hasAppleAccount,
  loadAppleAuth,
  startAppleConfirmation,
  type AppleIDAuth,
} from './appleSignIn'

function fakeAuth(signIn: AppleIDAuth['signIn']) {
  return { init: vi.fn<AppleIDAuth['init']>(), signIn }
}

describe('hasAppleAccount', () => {
  it('is true only for a user with an Apple connection', () => {
    expect(
      hasAppleAccount({ externalAccounts: [{ provider: 'google' }, { provider: 'apple' }] }),
    ).toBe(true)
    expect(hasAppleAccount({ externalAccounts: [{ provider: 'google' }] })).toBe(false)
    expect(hasAppleAccount(null)).toBe(false)
    expect(hasAppleAccount(undefined)).toBe(false)
  })
})

describe('startAppleConfirmation', () => {
  it('asks Apple in a popup as the web client and returns the code', async () => {
    const auth = fakeAuth(async () => ({ authorization: { code: 'c1', state: 's1' } }))
    await expect(startAppleConfirmation(auth, 's1')).resolves.toEqual({ code: 'c1' })
    expect(auth.init).toHaveBeenCalledWith({
      clientId: 'app.crosstune.signin',
      scope: '',
      redirectURI: 'https://my.crosstune.app/settings/account',
      state: 's1',
      usePopup: true,
    })
  })

  it('opens the popup before returning, so it runs inside the click', () => {
    const signIn = vi.fn(async () => ({ authorization: { code: 'c1', state: 's1' } }))
    void startAppleConfirmation(fakeAuth(signIn), 's1')
    expect(signIn).toHaveBeenCalledOnce()
  })

  it.each(['popup_closed_by_user', 'user_cancelled_authorize'])(
    'treats %s as a cancel',
    async (error) => {
      const auth = fakeAuth(async () => Promise.reject({ error }))
      await expect(startAppleConfirmation(auth, 's1')).resolves.toBe('cancelled')
    },
  )

  it('fails on any other Apple error', async () => {
    const auth = fakeAuth(async () => Promise.reject({ error: 'invalid_request' }))
    await expect(startAppleConfirmation(auth, 's1')).resolves.toBe('failed')
  })

  it('fails when the state Apple returns is not the one sent', async () => {
    const auth = fakeAuth(async () => ({ authorization: { code: 'c1', state: 'other' } }))
    await expect(startAppleConfirmation(auth, 's1')).resolves.toBe('failed')
  })

  it('fails when Apple returns no code', async () => {
    const auth = fakeAuth(async () => ({ authorization: { state: 's1' } }) as never)
    await expect(startAppleConfirmation(auth, 's1')).resolves.toBe('failed')
  })

  it('fails without a loaded script', async () => {
    await expect(startAppleConfirmation(null, 's1')).resolves.toBe('failed')
  })
})

describe('loadAppleAuth', () => {
  afterEach(() => {
    document.querySelectorAll('script').forEach((script) => script.remove())
    delete window.AppleID
  })

  const appleScripts = () =>
    [...document.querySelectorAll('script')].filter((script) => script.src === APPLE_SCRIPT_URL)

  it("adds Apple's script once and resolves with its auth object", async () => {
    const first = loadAppleAuth()
    const second = loadAppleAuth()
    expect(appleScripts()).toHaveLength(1)
    const auth = fakeAuth(async () => ({ authorization: { code: 'c1' } }))
    window.AppleID = { auth }
    appleScripts()[0]!.dispatchEvent(new Event('load'))
    await expect(first).resolves.toBe(auth)
    await expect(second).resolves.toBe(auth)
  })

  it('rejects when the script fails, and a later call tries again', async () => {
    const failed = loadAppleAuth()
    appleScripts()[0]!.dispatchEvent(new Event('error'))
    await expect(failed).rejects.toThrow()
    expect(appleScripts()).toHaveLength(0)
    const retry = loadAppleAuth()
    expect(appleScripts()).toHaveLength(1)
    appleScripts()[0]!.dispatchEvent(new Event('error'))
    await expect(retry).rejects.toThrow()
  })
})
