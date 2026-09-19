/**
 * Move an item to the side of the target it was sent to. Naming a target and a side rather than
 * a step lets a screen that hides some items move past them without knowing where they are, and
 * makes the move idempotent: applying it again to an order that already holds it changes nothing.
 */
export function placeBeside<T>(
  items: readonly T[],
  idOf: (item: T) => string,
  itemId: string,
  targetId: string,
  side: 'before' | 'after',
): T[] {
  const ordered = [...items]
  const from = ordered.findIndex((item) => idOf(item) === itemId)
  if (from < 0 || ordered.findIndex((item) => idOf(item) === targetId) < 0 || itemId === targetId) {
    return ordered
  }
  const [moved] = ordered.splice(from, 1)
  const target = ordered.findIndex((item) => idOf(item) === targetId)
  ordered.splice(target + (side === 'after' ? 1 : 0), 0, moved!)
  return ordered
}

/**
 * Move an item just past the target: after it when the target was below, before it when above.
 */
export function moveBeside<T>(
  items: readonly T[],
  idOf: (item: T) => string,
  itemId: string,
  targetId: string,
): T[] {
  const from = items.findIndex((item) => idOf(item) === itemId)
  const target = items.findIndex((item) => idOf(item) === targetId)
  return placeBeside(items, idOf, itemId, targetId, from < target ? 'after' : 'before')
}
