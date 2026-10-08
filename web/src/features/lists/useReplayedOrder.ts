import { useRef, useState } from 'react'
import { messageFor } from '../../ui/useAction'
import { useLatest } from '../../ui/useLatest'
import { placeBeside } from '../../domain/order'

interface Move {
  itemId: string
  targetId: string
  /** Which side of the target the tune was sent to, decided once, when the move was made. */
  side: 'before' | 'after'
}

interface Pending<T> {
  move: Move
  /** The items on screen, and the order the store held, when this move's write settled. */
  settled?: { items: readonly T[]; order: readonly string[] }
}

// Replaying a side rather than a direction is what makes this safe to run twice: an order that
// already holds the move comes back unchanged, so a read landing mid-flight cannot flip it back.
const apply = (order: readonly string[], move: Move): string[] =>
  placeBeside(order, (id) => id, move.itemId, move.targetId, move.side)

/**
 * Whether two orders agree, comparing only the items both carry. A list view drops an item whose
 * tune rows have not arrived yet, which a read of the stored order still counts, so one list is
 * a superset of the other across a sync page boundary.
 */
const sameOrder = (a: readonly string[], b: readonly string[]): boolean => {
  const inB = new Set(b)
  const inA = new Set(a)
  const left = a.filter((id) => inB.has(id))
  const right = b.filter((id) => inA.has(id))
  return left.length === right.length && left.every((id, index) => id === right[index])
}

/**
 * A move is replayed onto the stored order until its own write settles and the first read after
 * that decides, the rule usePendingWrite follows, including its second half: a read that landed
 * before the write settled decides straight away, which the order the store held just after the
 * write answers. Nothing is inferred from the order alone, because a tune beside its target says
 * nothing about which move put it there. A move whose tune or target has left the list stops
 * early, having nothing left to say.
 */
const replaying = <T>(
  pending: Pending<T>,
  order: readonly string[],
  items: readonly T[],
): boolean =>
  order.includes(pending.move.itemId) &&
  order.includes(pending.move.targetId) &&
  (pending.settled === undefined ||
    (pending.settled.items === items && !sameOrder(order, pending.settled.order)))

export interface ReplayedOrder<T> {
  /** Every item in the order the screen shows: the stored order with each move in flight replayed. */
  ordered: T[]
  /** Send `rows[from]` beside `rows[to]`, showing it there at once and writing it behind. */
  move: (rows: readonly T[], from: number, to: number) => void
  /**
   * What the last move said it did, for a status line. It names the place the row was dropped
   * and is not rewritten when a sync later moves the row again: the region speaks for the
   * musician's own move, and a re-announcement for another device's change would read as theirs.
   */
  announcement: string
}

/**
 * An ordered collection with its in-flight moves shown before the store holds them, such as a
 * list's tunes or a tune's scans. `items` must be the array the query returned, since a
 * fresh array reads as a fresh read and would retire a move before the screen has caught up.
 */
export function useReplayedOrder<T>({
  items,
  idOf,
  write,
  readOrder,
  announce,
  onMoveStart,
  onError,
}: {
  items: readonly T[]
  idOf: (item: T) => string
  /** Store the move of `itemId` just past `targetId`. */
  write: (itemId: string, targetId: string) => Promise<void>
  /** The order the store holds now, as ids. */
  readOrder: () => Promise<string[]>
  /** What a status line says once `rows[from]` has gone to `to`, at the moment of the move. */
  announce: (rows: readonly T[], from: number, to: number) => string
  onMoveStart?: () => void
  onError: (message: string) => void
}): ReplayedOrder<T> {
  const [announcement, setAnnouncement] = useState('')
  const [moving, setMoving] = useState<readonly Pending<T>[]>([])
  const writes = useRef(Promise.resolve())
  // Written in the same task as the commit, so a write that settles later always finds the
  // items that are on screen, never an older read.
  const shownItemsRef = useLatest(items)

  // Every move still in flight is replayed onto the order the store holds, in the order they
  // were made, which is the order the store applies them in. A failed move drops out and the
  // moves after it land where the store puts them, with no later read to correct.
  const storedOrder = items.map(idOf)
  const inFlight = moving.filter((pending) => replaying(pending, storedOrder, items))
  if (inFlight.length !== moving.length) setMoving(inFlight)
  const order = inFlight.reduce((current, pending) => apply(current, pending.move), storedOrder)
  const byId = new Map(items.map((item) => [idOf(item), item]))
  const ordered = order.flatMap((id) => byId.get(id) ?? [])

  const move = (rows: readonly T[], from: number, to: number) => {
    const moved = rows[from]
    const target = rows[to]
    if (!moved || !target || from === to) return
    // A hidden row keeps its place because the target is a visible neighbor.
    const next: Pending<T> = {
      move: {
        itemId: idOf(moved),
        targetId: idOf(target),
        side: from < to ? 'after' : 'before',
      },
    }
    const said = announce(rows, from, to)
    setAnnouncement(said)
    onMoveStart?.()
    setMoving((current) => [...current, next])
    writes.current = writes.current
      .then(() => write(next.move.itemId, next.move.targetId))
      .then(
        async () => {
          // Read before the await, or a commit landing inside it would leave these two
          // describing different moments and neither of them able to retire the move.
          const shown = shownItemsRef.current
          const stored = await readOrder().then(
            (order) => order,
            () => null,
          )
          setMoving((current) =>
            stored === null
              ? // The write landed, so the store holds the move. With no read to say when the
                // screen catches up, following the store now beats waiting on an answer that
                // is not coming.
                current.filter((queued) => queued !== next)
              : current.map((queued) =>
                  queued === next
                    ? { ...queued, settled: { items: shown, order: stored } }
                    : queued,
                ),
          )
        },
        (caught: unknown) => {
          setMoving((current) => current.filter((queued) => queued !== next))
          // The row is back where it was, so this move's announcement would still claim it moved.
          setAnnouncement((current) => (current === said ? '' : current))
          onError(messageFor(caught))
        },
      )
  }

  return { ordered, move, announcement }
}
