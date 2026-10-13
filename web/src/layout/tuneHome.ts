/** Where a bare `/tunes/:tuneId` link opens the tune: in the Catalog stack. */
export function tuneHomePath(tuneId: string | undefined): string {
  return `/catalog/${tuneId}`
}

/** A tune opened from a list, in the Lists stack, where Back returns to the list. */
export function listTunePath(listId: string, tuneId: string): string {
  return `/lists/${listId}/tunes/${tuneId}`
}
