const KEY = 'crosstune.lastUserId'

export function rememberUser(userId: string): void {
  try {
    localStorage.setItem(KEY, userId)
  } catch {
    // Private mode or blocked storage: the app still works, it just cannot open offline.
  }
}

export function rememberedUser(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function forgetUser(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing to forget if storage is unavailable.
  }
}

const ACCOUNT_DELETED_KEY = 'crosstune.accountDeleted'

/** Marks that the account is gone, so the sign-in screen shows its notice until someone signs in. */
export function markAccountDeleted(): void {
  try {
    sessionStorage.setItem(ACCOUNT_DELETED_KEY, '1')
  } catch {
    // Private mode or blocked storage: the notice is best-effort.
  }
}

export function hasAccountDeletedNotice(): boolean {
  try {
    return sessionStorage.getItem(ACCOUNT_DELETED_KEY) !== null
  } catch {
    return false
  }
}

export function clearAccountDeletedNotice(): void {
  try {
    sessionStorage.removeItem(ACCOUNT_DELETED_KEY)
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

const SIGNED_OUT_KEY = 'crosstune.signedOutUser'
const signOutListeners = new Set<() => void>()
// Mirrored in memory so the flag holds for this page even where storage is blocked; storage
// carries it across a reload.
let signedOutUser: string | null = (() => {
  try {
    return sessionStorage.getItem(SIGNED_OUT_KEY)
  } catch {
    return null
  }
})()

function setSignedOutUser(userId: string | null): void {
  signedOutUser = userId
  try {
    if (userId === null) sessionStorage.removeItem(SIGNED_OUT_KEY)
    else sessionStorage.setItem(SIGNED_OUT_KEY, userId)
  } catch {
    // The in-memory copy still holds for this page.
  }
  for (const listener of signOutListeners) listener()
}

/**
 * Treats this user as signed out on this device even while Clerk still holds a session for it,
 * so a sign-out that failed after the account was deleted never leaves the app open over a
 * deleted database.
 */
export function markSignedOutLocally(userId: string): void {
  setSignedOutUser(userId)
}

export function locallySignedOutUser(): string | null {
  return signedOutUser
}

export function clearLocalSignOut(): void {
  if (signedOutUser !== null) setSignedOutUser(null)
}

export function subscribeLocalSignOut(listener: () => void): () => void {
  signOutListeners.add(listener)
  return () => {
    signOutListeners.delete(listener)
  }
}
