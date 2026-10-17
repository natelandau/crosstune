import * as Sentry from '@sentry/react'

/**
 * Sign in with Apple JS, used only to get a fresh authorization code when an account with an
 * Apple connection is deleted, so the API can revoke it. Clerk signs people in with Apple; it
 * never hands over a code the API could revoke with.
 */

/** The only origin registered on the Services ID; Apple refuses the popup anywhere else. */
export const APPLE_SIGN_IN_ORIGIN = 'https://my.crosstune.app'
export const APPLE_SCRIPT_URL =
  'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js'
const APPLE_WEB_CLIENT_ID = 'app.crosstune.signin'
// A return URL registered on the Services ID. The popup answers by postMessage, so nothing
// loads there.
const APPLE_REDIRECT_URI = `${APPLE_SIGN_IN_ORIGIN}/settings/account`
const CANCEL_ERRORS = new Set(['popup_closed_by_user', 'user_cancelled_authorize'])

interface AppleIDConfig {
  clientId: string
  scope: string
  redirectURI: string
  state: string
  usePopup: boolean
}

interface AppleIDResponse {
  authorization: { code?: string; state?: string }
}

/** The part of Apple's `AppleID.auth` this page uses. */
export interface AppleIDAuth {
  init(config: AppleIDConfig): void
  signIn(): Promise<AppleIDResponse>
}

declare global {
  interface Window {
    AppleID?: { auth: AppleIDAuth }
  }
}

/** A code to send with the delete, a cancel that stops it, or a failure that deletes without one. */
export type AppleConfirmation = { code: string } | 'cancelled' | 'failed'

export function hasAppleAccount(
  user: { externalAccounts: readonly { provider: string }[] } | null | undefined,
): boolean {
  return user?.externalAccounts.some((account) => account.provider === 'apple') ?? false
}

export function onAppleOrigin(): boolean {
  return window.location.origin === APPLE_SIGN_IN_ORIGIN
}

let loading: Promise<AppleIDAuth> | null = null

/** Loads Apple's script once. A failed load removes its tag, so the next call tries again. */
export function loadAppleAuth(): Promise<AppleIDAuth> {
  if (window.AppleID) return Promise.resolve(window.AppleID.auth)
  if (loading) return loading
  loading = new Promise<AppleIDAuth>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = APPLE_SCRIPT_URL
    script.async = true
    script.addEventListener('load', () => {
      if (window.AppleID) resolve(window.AppleID.auth)
      else reject(new Error('Apple sign-in script loaded without AppleID'))
    })
    script.addEventListener('error', () => {
      script.remove()
      reject(new Error('Apple sign-in script failed to load'))
    })
    document.head.append(script)
  }).finally(() => {
    loading = null
  })
  return loading
}

function report(reason: string): 'failed' {
  // Apple's error value only; the response would carry the code.
  Sentry.captureMessage('Sign in with Apple confirmation failed', { extra: { reason } })
  return 'failed'
}

/**
 * Opens Apple's popup before returning, so a caller in a click handler opens it inside the
 * click and the browser allows it.
 */
export function startAppleConfirmation(
  auth: AppleIDAuth | null,
  state: string = crypto.randomUUID(),
): Promise<AppleConfirmation> {
  if (!auth) return Promise.resolve(report('not_loaded'))
  let answer: Promise<AppleIDResponse>
  try {
    auth.init({
      clientId: APPLE_WEB_CLIENT_ID,
      scope: '',
      redirectURI: APPLE_REDIRECT_URI,
      state,
      usePopup: true,
    })
    answer = auth.signIn()
  } catch {
    return Promise.resolve(report('init'))
  }
  return answer.then(
    ({ authorization }): AppleConfirmation => {
      if (authorization.state !== state) return report('state_mismatch')
      if (!authorization.code) return report('no_code')
      return { code: authorization.code }
    },
    (error: unknown): AppleConfirmation => {
      const reason =
        typeof error === 'object' && error !== null && 'error' in error
          ? String(error.error)
          : 'unknown'
      return CANCEL_ERRORS.has(reason) ? 'cancelled' : report(reason)
    },
  )
}
