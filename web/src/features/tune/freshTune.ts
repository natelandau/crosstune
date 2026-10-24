// A tune just created from its title, mapped to the toast whose Undo deletes it. Its page
// takes the entry once it opens, so Undo can be withdrawn before it deletes anything added.
const fresh = new Map<string, number>()

/** Marks a new tune as offering Undo on the toast with this id, replacing any older mark. */
export function markFresh(tuneId: string, toastId: number): void {
  // One toast shows at a time, so an older mark's Undo is already gone.
  fresh.clear()
  fresh.set(tuneId, toastId)
}

/** The toast id a new tune was marked with, forgotten as it is returned. */
export function takeFresh(tuneId: string): number | null {
  const toastId = fresh.get(tuneId) ?? null
  fresh.delete(tuneId)
  return toastId
}

export function clearFresh(): void {
  fresh.clear()
  keyFocus = null
}

// A tune created on the new-tune page, whose key tile takes focus as its page opens.
let keyFocus: string | null = null

export function markKeyFocus(tuneId: string): void {
  keyFocus = tuneId
}

/** Whether the tune's key tile should take focus, forgotten as it is answered. */
export function takeKeyFocus(tuneId: string): boolean {
  if (keyFocus !== tuneId) return false
  keyFocus = null
  return true
}
