import type { EndedBy, Queue, Source, Trigger } from '../../analytics/events'
import type { PlayContext } from '../../api/vocabulary'
import { AudibleSpan } from './activity'

/** Audible time a play needs, unless the item itself is shorter. */
export const PLAY_THRESHOLD_MS = 10_000

/** How a play reports to analytics: the surface that started it and whether a list did. */
export interface PlayAttribution {
  source: Source
  queue: Queue
  trigger: Trigger
}

/** Where a play was asked for. */
export interface PlayOrigin {
  context: PlayContext
  listId?: string
  /** Only reported, never stored, so the API's play contexts stay as they are. */
  report?: PlayAttribution
}

/** A one-off play started by a tap on `source`. */
export function tappedFrom(source: Source): PlayAttribution {
  return { source, queue: 'single', trigger: 'tap' }
}

/** A play from a recording or link row on a tune's page. */
export const TUNE_ROW_ORIGIN: PlayOrigin = { context: 'row', report: tappedFrom('tune') }
/** A play from a row of the Recordings list. */
export const RECORDINGS_ROW_ORIGIN: PlayOrigin = {
  context: 'row',
  report: tappedFrom('recordings_list'),
}

/** A play that closed after sounding, as it is reported. */
export interface EndedPlay {
  recordingId: string
  origin: PlayOrigin
  listenedMs: number
  /** The heard length, 0 when it was never known. */
  lengthMs: number
  endedBy: EndedBy
  /** Whether a lock-screen or headset control acted on the play. */
  systemControlled: boolean
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
  systemControlled: boolean
}

/**
 * Times one recording at a time by wall-clock time while it plays, at any speed, and writes it
 * as a play when it ends having met the threshold. Every play that sounded at all, threshold or
 * not, also goes to `onEnded`.
 */
export class PlayLog {
  #open: OpenPlay | null = null

  constructor(
    private readonly now: () => number,
    private readonly write: (record: PlayRecord) => void,
    private readonly onEnded: (ended: EndedPlay) => void = () => {},
  ) {}

  /** The recording the open play is for. */
  get current(): string | null {
    return this.#open?.recordingId ?? null
  }

  /** Where the open play was asked for. */
  get origin(): PlayOrigin | null {
    return this.#open?.origin ?? null
  }

  /** Ends any open play as skipped, then opens one for `recordingId`, not yet playing. */
  start(recordingId: string, origin: PlayOrigin, lengthMs = 0): void {
    this.end('skipped')
    this.#open = {
      recordingId,
      origin,
      lengthMs,
      span: new AudibleSpan(),
      listenedMs: 0,
      systemControlled: false,
    }
  }

  /** Notes that a control outside the app acted on the open play. */
  systemControlled(): void {
    if (this.#open) this.#open.systemControlled = true
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

  /** Reports the open play if it sounded, writes it if it met the threshold, and closes it. */
  end(endedBy: EndedBy): void {
    const open = this.#open
    if (!open) return
    this.playing(false)
    this.#open = null
    if (open.listenedMs > 0) {
      this.onEnded({
        recordingId: open.recordingId,
        origin: open.origin,
        listenedMs: open.listenedMs,
        lengthMs: open.lengthMs,
        endedBy,
        systemControlled: open.systemControlled,
      })
    }
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

  /**
   * Ends the open play as `endedBy` and opens a fresh one for the same item, not yet playing,
   * from `origin` or else where the ended play was asked for.
   */
  flush(endedBy: EndedBy, origin?: PlayOrigin): void {
    const open = this.#open
    if (!open) return
    this.end(endedBy)
    this.start(open.recordingId, origin ?? open.origin, open.lengthMs)
  }

  /** Closes the open play without writing it. */
  drop(): void {
    this.#open = null
  }
}
