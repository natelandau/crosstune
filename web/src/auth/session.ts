import { readStored, writeStored } from '../platform/storage'

const KEY = 'crosstune.lastUserId'

/** Blocked storage drops the write: the app still works, it just cannot open offline. */
export function rememberUser(userId: string): void {
  writeStored(KEY, userId)
}

export function rememberedUser(): string | null {
  return readStored(KEY)
}

export function forgetUser(): void {
  writeStored(KEY, null)
}

const ACCOUNT_DELETED_KEY = 'crosstune.accountDeleted'

/** Marks that the account is gone, so the sign-in screen shows its notice until someone signs in. */
export function markAccountDeleted(): void {
  writeStored(ACCOUNT_DELETED_KEY, '1', 'session')
}

export function hasAccountDeletedNotice(): boolean {
  return readStored(ACCOUNT_DELETED_KEY, 'session') !== null
}

export function clearAccountDeletedNotice(): void {
  writeStored(ACCOUNT_DELETED_KEY, null, 'session')
}

const SIGNED_OUT_KEY = 'crosstune.signedOutUser'
const signOutListeners = new Set<() => void>()
// Mirrored in memory so the flag holds for this page even where storage is blocked; storage
// carries it across a reload.
let signedOutUser: string | null = readStored(SIGNED_OUT_KEY, 'session')

function setSignedOutUser(userId: string | null): void {
  signedOutUser = userId
  writeStored(SIGNED_OUT_KEY, userId, 'session')
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

export const ACCOUNT_DELETED = 'Your account and all its data were deleted.'
