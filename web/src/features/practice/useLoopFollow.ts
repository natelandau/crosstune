import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { LocalRecordingLoop } from '../../db/types'
import type { PlaybackEngine, PlaybackLoop } from '../player/playbackEngine'
import { usePlaybackEngine } from '../player/PlaybackEngineProvider'
import { loopName, rowSpan, type Span } from './loopModel'

/**
 * A span played for loop `id` ahead of its row. `base` is the row's span when the hold was
 * taken: once the row moves off it, a write (this device's or a newer one from elsewhere) has
 * landed and the row is followed again.
 */
interface LoopHold {
  id: string
  span: Span
  base: Span | null
}

/** The one hold per engine, shared by Practice, which takes it, and the follower, which plays it. */
class LoopHolds {
  private hold: LoopHold | null = null
  private readonly listeners = new Set<() => void>()

  get(): LoopHold | null {
    return this.hold
  }

  /** Takes or lets go of the hold and has the follower play the result. */
  set(hold: LoopHold | null): void {
    this.hold = hold
    for (const fn of this.listeners) fn()
  }

  /** Lets go of the hold without telling the follower, for a caller about to set the range. */
  drop(): void {
    this.hold = null
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
}

const holdsByEngine = new WeakMap<PlaybackEngine, LoopHolds>()

/** The loop hold for `engine`, made on first use. */
export function loopHolds(engine: PlaybackEngine): LoopHolds {
  let holds = holdsByEngine.get(engine)
  if (!holds) {
    holds = new LoopHolds()
    holdsByEngine.set(engine, holds)
  }
  return holds
}

/** Where the loaded blob sits on the source timeline, and where the trim starts. */
export interface LoopOffsets {
  blobStartMs: number
  trimStartMs: number
}

/** The engine's range for `row`, in seconds into the loaded blob, playing any hold on it. */
export function loopRange(
  row: LocalRecordingLoop,
  hold: LoopHold | null,
  { blobStartMs, trimStartMs }: LoopOffsets,
): PlaybackLoop {
  const span = hold?.id === row.id ? hold.span : rowSpan(row)
  return {
    id: row.id,
    label: loopName(row.label ?? null, span.startMs, trimStartMs),
    fromS: (span.startMs - blobStartMs) / 1000,
    toS: (span.endMs - blobStartMs) / 1000,
  }
}

const matches = (row: LocalRecordingLoop, span: Span) =>
  row.start_ms === span.startMs && row.end_ms === span.endMs

const sameRange = (a: Readonly<PlaybackLoop> | null, b: PlaybackLoop) =>
  !!a && a.id === b.id && a.label === b.label && a.fromS === b.fromS && a.toS === b.toS

/**
 * Keeps the engine's chosen loop in step with its row for as long as the recording is loaded,
 * whether or not Practice is open: a new span or label reaches the range and the badge, a new
 * blob gets the range in its own offsets, and a deleted loop drops the selection and Repeat.
 * Loop times are on the source timeline and the engine's are in seconds into the loaded blob.
 */
export function useLoopFollow(loops: LocalRecordingLoop[] | undefined, offsets: LoopOffsets): void {
  const engine = usePlaybackEngine()
  const holds = loopHolds(engine)
  const latest = useRef({ loops, offsets })
  useLayoutEffect(() => {
    latest.current = { loops, offsets }
  })

  /** Hands the engine the chosen loop's range when what it holds differs. */
  const sync = useCallback(() => {
    const id = engine.getState().loop?.id
    if (!id) return
    const row = latest.current.loops?.find((l) => l.id === id)
    if (!row) return
    const range = loopRange(row, holds.get(), latest.current.offsets)
    if (!sameRange(engine.loopRange, range)) engine.setLoop(range)
  }, [engine, holds])

  // A `keepLoop` reload suspends the range whenever it lands, which can be after the file row
  // that describes the new blob has already arrived.
  useEffect(() => engine.subscribe(sync), [engine, sync])
  useEffect(() => holds.subscribe(sync), [holds, sync])

  const { blobStartMs, trimStartMs } = offsets
  useEffect(() => {
    if (!loops) return
    const id = engine.getState().loop?.id
    if (id && !loops.some((l) => l.id === id)) {
      holds.drop()
      engine.setLoop(null)
      engine.setRepeat(false)
      return
    }
    const hold = holds.get()
    const row = hold && loops.find((l) => l.id === hold.id)
    if (row && (!hold.base || !matches(row, hold.base) || matches(row, hold.span))) {
      holds.drop()
    }
    sync()
  }, [engine, holds, loops, blobStartMs, trimStartMs, sync])
}
