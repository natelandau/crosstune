import type { PlayContext } from '../../api/vocabulary'
import { AudibleSpan } from './activity'

/** Audible time a play needs, unless the item itself is shorter. */
export const PLAY_THRESHOLD_MS = 10_000

/** Where a play was asked for. */
export interface PlayOrigin {
  context: PlayContext
  listId?: string
}

/** One play, timed on the injected clock. */
export interface PlayRecord {
  recordingId: string
  context: PlayContext
  listId: string | null
  startedAt: number
  listenedMs: number
}

/**
 * How long `lengthMs` of audio takes to hear at `speedPercent`, so "the whole item" means the
 * whole item at any speed.
 */
export function heardLengthMs(lengthMs: number, speedPercent: number): number {
  return speedPercent > 0 ? Math.round((lengthMs * 100) / speedPercent) : lengthMs
}

/** Whether `listenedMs` of an item `lengthMs` long is a play; an unknown length (0) needs the
 * full threshold. */
function meetsPlayThreshold(listenedMs: number, lengthMs: number): boolean {
  const needed = lengthMs > 0 ? Math.min(PLAY_THRESHOLD_MS, lengthMs) : PLAY_THRESHOLD_MS
  return listenedMs > 0 && listenedMs >= needed
}

interface OpenPlay {
  recordingId: string
  origin: PlayOrigin
  lengthMs: number
  span: AudibleSpan
  listenedMs: number
}

/**
 * Times one recording at a time by wall-clock time while it plays, at any speed, and writes it
 * as a play when it ends having met the threshold.
 */
export class PlayLog {
  #open: OpenPlay | null = null

  constructor(
    private readonly now: () => number,
    private readonly write: (record: PlayRecord) => void,
  ) {}

  /** The recording the open play is for. */
  get current(): string | null {
    return this.#open?.recordingId ?? null
  }

  /** Ends any open play, then opens one for `recordingId`, not yet playing. */
  start(recordingId: string, origin: PlayOrigin, lengthMs = 0): void {
    this.end()
    this.#open = {
      recordingId,
      origin,
      lengthMs,
      span: new AudibleSpan(),
      listenedMs: 0,
    }
  }

  /** The trimmed length as heard at the current speed, once the engine knows it. */
  setLength(lengthMs: number): void {
    if (this.#open) this.#open.lengthMs = lengthMs
  }

  playing(isPlaying: boolean): void {
    const open = this.#open
    if (!open) return
    if (isPlaying) open.span.start(this.now())
    else open.listenedMs += open.span.stop(this.now())
  }

  /** Writes the open play if it met the threshold, and closes it. */
  end(): void {
    const open = this.#open
    if (!open) return
    this.playing(false)
    this.#open = null
    const startedAt = open.span.startedAt
    if (startedAt === null || !meetsPlayThreshold(open.listenedMs, open.lengthMs)) return
    this.write({
      recordingId: open.recordingId,
      context: open.origin.context,
      listId: open.origin.listId ?? null,
      startedAt,
      listenedMs: open.listenedMs,
    })
  }

  /** Ends the open play and opens a fresh one for the same item and origin, not yet playing. */
  flush(): void {
    const open = this.#open
    if (!open) return
    this.start(open.recordingId, open.origin, open.lengthMs)
  }

  /** Closes the open play without writing it. */
  drop(): void {
    this.#open = null
  }
}
