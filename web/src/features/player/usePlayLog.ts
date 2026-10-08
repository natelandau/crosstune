import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { recordEvent } from '../../commands/events'
import { newId } from '../../commands/write'
import { DbContext } from '../../db/DbProvider'
import type { CrosstuneDb } from '../../db/schema'
import { useLatest } from '../../ui/useLatest'
import { iso, onPageLeave } from './activity'
import { heardLengthMs, PlayLog, type PlayOrigin, type PlayRecord } from './playLog'
import type { PlaybackEngine, PlaybackState } from './playbackEngine'
import type { PlayerItem } from '../../domain/playerItem'

/**
 * How practice takes the loaded recording's time from the play log and gives it back.
 * While practice is open, its practice log decides what the time spent there becomes.
 */
export interface PlayLogControl {
  /**
   * Practice now shows `recordingId`: ends the play under way and opens one in the
   * `recording_screen` context. Returns whether the recording was already the one loaded, so its
   * playing state is the engine's current one.
   */
  practiceOpened: (recordingId: string) => boolean
  /**
   * Whether practice's play is counting time: practice passes its audio playing outside the
   * trim view. The engine's own playing state is not followed while practice holds the play.
   */
  practicePlaying: (counting: boolean) => void
  /**
   * Whether practice's recording is the one loaded. Until it is, the engine plays another
   * recording, whose audio and settings are not the visit's.
   */
  practiceLoaded: () => boolean
  /**
   * Practice has let go: keeps its play when `keep`, or drops it when the visit became a
   * practice session. Playing on in the dock afterward is a fresh play.
   */
  practiceClosed: (keep: boolean) => void
}

const detached: PlayLogControl = {
  practiceOpened: () => false,
  practicePlaying: () => {},
  practiceLoaded: () => true,
  practiceClosed: () => {},
}

// Practice rendered without PlayerProvider, as in a test with a stand-in player,
// logs nothing.
export const PlayLogContext = createContext<PlayLogControl>(detached)

export function usePlayLogControl(): PlayLogControl {
  return useContext(PlayLogContext)
}

async function recordPlay(db: CrosstuneDb, record: PlayRecord, createdAt: number): Promise<void> {
  const recording = await db.recordings.get(record.recordingId)
  await recordEvent(db, 'play_events', {
    id: newId(),
    tune_id: recording?.tune_id ?? null,
    recording_id: record.recordingId,
    link_id: null,
    context: record.context,
    list_id: record.listId,
    started_at: iso(record.startedAt),
    listened_ms: record.listenedMs,
    created_at: iso(createdAt),
  })
}

/**
 * Logs each recording the player plays, timed while the engine reports it playing. Links are
 * never logged: an embed gives no play, pause, or end signal. Reaching the end closes the play,
 * so playing it again is another. A play open when the page goes away is written then, since the
 * page may never come back; a tab merely hidden while it plays keeps its play going.
 */
export function usePlayLog(
  engine: PlaybackEngine,
  item: PlayerItem | null,
  origin: PlayOrigin,
  { now = Date.now }: { now?: () => number } = {},
): PlayLogControl {
  const db = useContext(DbContext)
  const itemRef = useLatest(item)
  const originRef = useLatest(origin)
  // Set by the effect below, which builds a log per database: a play belongs to the database
  // that was open while it played, never the one a new user brings in.
  const logRef = useRef<PlayLog | null>(null)
  // The recording practice has taken over, whose play practice ends.
  const practiceOwned = useRef<string | null>(null)
  // Whether the engine's length belongs to the open play. A new item's play waits for the
  // outgoing recording to unload (length 0), so its last ticks never set the new length.
  const lengthReady = useRef(true)

  // A layout effect, so the log exists before practice's effects, which run first
  // as its descendants, reach it.
  useLayoutEffect(() => {
    const log = new PlayLog(now, (record) => {
      // A lost play is not worth interrupting the musician over.
      if (db) void recordPlay(db, record, now()).catch(() => {})
    })
    logRef.current = log
    lengthReady.current = true
    const loaded = itemRef.current
    if (loaded?.kind === 'recording') log.start(loaded.id, originRef.current)

    // Following the engine, not the player, so a pause from the lock screen or a headset
    // counts. Only a change of `playing` is passed on: the outgoing recording keeps reporting
    // until it is unloaded, and its playing must not run into the next item's play.
    let prev: PlaybackState = engine.getState()
    const unsubscribe = engine.subscribe((state) => {
      if (state.lengthMs === 0) lengthReady.current = true
      else if (lengthReady.current) log.setLength(heardLengthMs(state.lengthMs, state.speedPercent))
      if (state.playing !== prev.playing && practiceOwned.current === null)
        log.playing(state.playing)
      prev = state
    })
    // A visit to practice is one unit whatever it plays; practice ends its play.
    const unsubscribeEnded = engine.onEnded(() => {
      if (practiceOwned.current === null) log.flush()
    })

    const unsubscribeLeave = onPageLeave((how) => {
      if (practiceOwned.current !== null || log.current === null) return
      // A desktop tab keeps playing behind another, and that is still one listen.
      if (how === 'hidden' && engine.getState().playing) return
      log.flush()
      log.playing(engine.getState().playing)
    })
    return () => {
      unsubscribeLeave()
      unsubscribeEnded()
      unsubscribe()
      log.drop()
      logRef.current = null
    }
  }, [db, engine, now, itemRef, originRef])

  const recordingId = item?.kind === 'recording' ? item.id : null
  useEffect(() => {
    const log = logRef.current
    if (!log || recordingId === log.current) return
    if (recordingId === null) {
      log.end()
      return
    }
    lengthReady.current = engine.getState().lengthMs === 0
    log.start(recordingId, originRef.current)
  }, [recordingId, engine, originRef])

  return useMemo<PlayLogControl>(() => {
    const resume = (log: PlayLog, id: string, playOrigin: PlayOrigin) => {
      const state = engine.getState()
      log.start(id, playOrigin, heardLengthMs(state.lengthMs, state.speedPercent))
      log.playing(state.playing)
    }
    return {
      practiceOpened: (id) => {
        practiceOwned.current = id
        const log = logRef.current
        if (!log) return false
        const loaded = log.current === id
        if (loaded) {
          const state = engine.getState()
          log.start(
            id,
            { context: 'recording_screen' },
            heardLengthMs(state.lengthMs, state.speedPercent),
          )
        } else {
          lengthReady.current = engine.getState().lengthMs === 0
          log.start(id, { context: 'recording_screen' })
        }
        return loaded
      },
      practicePlaying: (counting) => {
        if (practiceOwned.current !== null) logRef.current?.playing(counting)
      },
      practiceLoaded: () => {
        const current = itemRef.current
        return current?.kind === 'recording' && current.id === practiceOwned.current
      },
      practiceClosed: (keep) => {
        const id = practiceOwned.current
        practiceOwned.current = null
        const log = logRef.current
        if (!log) return
        if (keep) log.end()
        else log.drop()
        const current = itemRef.current
        if (id !== null && current?.kind === 'recording' && current.id === id) {
          resume(log, id, { context: 'dock' })
        }
      },
    }
  }, [engine, itemRef])
}
