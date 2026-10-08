/** What a playing list does when a tune ends. */
export type RepeatMode = 'off' | 'list' | 'one'

/** Past this far into a tune, previous restarts it rather than going back. */
export const RESTART_AFTER_MS = 3000

/**
 * The order a list's tunes play in and where playback stands in it. It holds tune ids only,
 * each at most once; what each tune plays is the caller's concern. Every move returns a new
 * queue.
 */
export interface Queue {
  /** The tunes in list order, for returning to it from a shuffle. */
  readonly listOrder: readonly string[]
  /** The tunes in play order. */
  readonly order: readonly string[]
  readonly index: number
  readonly shuffled: boolean
  /** The tune that is playing, or null for an empty list. */
  readonly current: string | null
  /** The current tune's place in the play order, counting from 1. Zero for an empty list. */
  readonly position: number
  readonly count: number
}

function build(
  listOrder: readonly string[],
  order: readonly string[],
  index: number,
  shuffled: boolean,
): Queue {
  return {
    listOrder,
    order,
    index,
    shuffled,
    current: order[index] ?? null,
    position: order.length === 0 ? 0 : index + 1,
    count: order.length,
  }
}

/**
 * A Fisher-Yates shuffle. With `avoidingFirst`, two or more tunes never open with that tune;
 * it swaps into a random later slot, so the result takes a bounded number of draws.
 */
function shuffle(ids: readonly string[], random: () => number, avoidingFirst?: string): string[] {
  const out = [...ids]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  if (avoidingFirst !== undefined && out.length > 1 && out[0] === avoidingFirst) {
    const j = 1 + Math.floor(random() * (out.length - 1))
    ;[out[0], out[j]] = [out[j]!, out[0]!]
  }
  return out
}

/**
 * A queue over `tuneIds`. A tune listed twice plays once, where it first appears. A shuffled
 * queue opens on whichever tune the shuffle puts first.
 */
export function createQueue(
  tuneIds: readonly string[],
  { shuffled, random = Math.random }: { shuffled: boolean; random?: () => number },
): Queue {
  const listOrder = [...new Set(tuneIds)]
  return build(listOrder, shuffled ? shuffle(listOrder, random) : listOrder, 0, shuffled)
}

/**
 * The queue after a tune ends on its own (`manual` false) or is skipped. A natural end with
 * repeat one replays; a skip leaves the tune, so it moves on as repeat list does. At the end
 * with repeat off the queue stays on its last tune and reports `ended`. Wrapping a shuffled
 * queue reshuffles it.
 */
export function next(
  queue: Queue,
  {
    manual,
    repeat,
    random = Math.random,
  }: { manual: boolean; repeat: RepeatMode; random?: () => number },
): { queue: Queue; ended: boolean } {
  if (queue.count === 0) return { queue, ended: true }
  if (!manual && repeat === 'one') return { queue, ended: false }
  if (queue.index + 1 < queue.count) {
    return {
      queue: build(queue.listOrder, queue.order, queue.index + 1, queue.shuffled),
      ended: false,
    }
  }
  if (repeat === 'off') return { queue, ended: true }
  const order = queue.shuffled
    ? shuffle(queue.order, random, queue.current ?? undefined)
    : queue.order
  return { queue: build(queue.listOrder, order, 0, queue.shuffled), ended: false }
}

/**
 * Back one tune, or `restart` the current one once it has played past `RESTART_AFTER_MS` or
 * when it is the first. Never wraps.
 */
export function previous(queue: Queue, elapsedMs: number): { queue: Queue; restart: boolean } {
  if (elapsedMs > RESTART_AFTER_MS || queue.index === 0) return { queue, restart: true }
  return {
    queue: build(queue.listOrder, queue.order, queue.index - 1, queue.shuffled),
    restart: false,
  }
}

/**
 * Shuffling keeps the tunes already played and the current one where they are and shuffles
 * only those still to come. Unshuffling returns to list order from the current tune.
 */
export function setShuffled(queue: Queue, on: boolean, random: () => number = Math.random): Queue {
  if (on === queue.shuffled) return queue
  if (on) {
    const ahead = queue.index + 1
    const order = [...queue.order.slice(0, ahead), ...shuffle(queue.order.slice(ahead), random)]
    return build(queue.listOrder, order, queue.index, true)
  }
  const index = queue.current === null ? 0 : queue.listOrder.indexOf(queue.current)
  return build(queue.listOrder, queue.listOrder, Math.max(index, 0), false)
}

/** The queue moved to `tuneId`, or null when the queue lacks it. */
export function jump(queue: Queue, tuneId: string): Queue | null {
  const index = queue.order.indexOf(tuneId)
  return index === -1 ? null : build(queue.listOrder, queue.order, index, queue.shuffled)
}

/** Off, then repeat the list, then repeat the tune, then off again. */
export function cycleRepeat(mode: RepeatMode): RepeatMode {
  return mode === 'off' ? 'list' : mode === 'list' ? 'one' : 'off'
}
