/** What a navigation to a tune carries about how the tune was picked. */
export interface TunePick {
  /** Picked from the keyboard, so the page swaps in with no motion. */
  quiet: boolean
}

/**
 * How the tune being picked now was picked, read during the event. Focus shows its ring only
 * after keyboard input, so a ring on the focused element marks a keyboard pick.
 */
export function tunePick(): TunePick {
  return { quiet: document.activeElement?.matches(':focus-visible') ?? false }
}

/** Whether a location's state marks a keyboard pick. */
export function isQuietPick(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as Partial<TunePick>).quiet === true
}
