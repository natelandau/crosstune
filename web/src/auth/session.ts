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
