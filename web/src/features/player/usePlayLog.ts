import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useAnalytics } from '../../analytics/AnalyticsProvider'
import {
  createPlaybackReporter,
  playedRows,
  type PlaybackReporter,
} from '../../analytics/playbackReporter'
import { recordEvent } from '../../commands/events'
import { newId } from '../../commands/write'
import { DbContext } from '../../db/DbProvider'
import type { CrosstuneDb } from '../../db/schema'
import { useLatest } from '../../ui/useLatest'
import type { EndedBy } from '../../analytics/events'
import { iso, onPageLeave, type PageLeave } from './activity'
import {
  heardLengthMs,
  PlayLog,
  tappedFrom,
  type PlayAttribution,
  type PlayOrigin,
  type PlayRecord,
} from './playLog'
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
   * practice session. Playing on in the dock afterward is a fresh play. `leaving` says the page
   * went away, after which practice still open starts its next visit at once.
   */
  practiceClosed: (keep: boolean, leaving?: PageLeave) => void
  /**
   * A playing list tells how it replays a recording that reaches its natural end: as which
   * attribution, or null when it moves on or stops. Returns the unregister.
   */
  replayedByQueue: (replay: (recordingId: string) => PlayAttribution | null) => () => void
}

/** A play on practice, which keeps reporting from there while it plays on in the dock. */
const PRACTICE_REPORT = tappedFrom('recording_screen')
const PRACTICE_ORIGIN: PlayOrigin = { context: 'recording_screen', report: PRACTICE_REPORT }
const PLAYED_ON_ORIGIN: PlayOrigin = { context: 'dock', report: PRACTICE_REPORT }

/**
 * Where the play reopened after a playlist's natural end comes from: the list again when it
 * replays the recording, otherwise a Play pressed in the dock. Any other play keeps its origin.
 */
function afterNaturalEnd(
  origin: PlayOrigin,
  again: PlayAttribution | null,
): PlayOrigin | undefined {
  if (origin.report?.queue !== 'playlist') return undefined
  return { ...origin, report: again ?? tappedFrom('dock') }
}

/** Why a play open as the page goes away ends: hidden is a pause, unloaded is a close. */
function leftAs(how: PageLeave): EndedBy {
  return how === 'hidden' ? 'paused' : 'closed'
}

const detached: PlayLogControl = {
  practiceOpened: () => false,
  practicePlaying: () => {},
  practiceLoaded: () => true,
  practiceClosed: () => {},
  replayedByQueue: () => () => {},
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
 * never logged: an embed gives no play, pause, or end signal, so a link is only reported, untimed,
 * when it leaves the player. Reaching the end closes the play, so playing it again is another. A
 * play open when the page goes away is written then, since the page may never come back; a tab
 * merely hidden while it plays keeps its play going.
 */
export function usePlayLog(
  engine: PlaybackEngine,
  item: PlayerItem | null,
  origin: PlayOrigin,
  { now = Date.now }: { now?: () => number } = {},
): PlayLogControl {
  const db = useContext(DbContext)
  const analytics = useAnalytics()
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
  // Built beside the log, for the same database.
  const reporterRef = useRef<PlaybackReporter | null>(null)
  // The link in the player and where it was asked for, reported when it leaves.
  const openLink = useRef<{ linkId: string; origin: PlayOrigin } | null>(null)
  // How a playing list replays a recording at its natural end.
  const queueReplay = useRef<((recordingId: string) => PlayAttribution | null) | null>(null)
  // Set while practice hands its play back only to take it again as the page goes away, so the
  // instant between is no play of its own.
  const handingOff = useRef(false)

  // A layout effect, so the log exists before practice's effects, which run first
  // as its descendants, reach it.
  useLayoutEffect(() => {
    const reporter = createPlaybackReporter(analytics, db ? playedRows(db) : null)
    const log = new PlayLog(
      now,
      (record) => {
        // A lost play is not worth interrupting the musician over.
        if (db) void recordPlay(db, record, now()).catch(() => {})
      },
      (ended) => void reporter.ended(ended),
    )
    logRef.current = log
    reporterRef.current = reporter
    lengthReady.current = true
    const loaded = itemRef.current
    if (loaded?.kind === 'recording') log.start(loaded.id, originRef.current)
    openLink.current =
      loaded?.kind === 'link' ? { linkId: loaded.id, origin: originRef.current } : null
    const unsubscribeSystem = engine.onSystemAction(() => log.systemControlled())

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
      const origin = log.origin
      const id = log.current
      if (practiceOwned.current !== null || !origin || id === null) return
      log.flush('finished', afterNaturalEnd(origin, queueReplay.current?.(id) ?? null))
    })

    const unsubscribeLeave = onPageLeave((how) => {
      const link = openLink.current
      if (how === 'pagehide' && link) {
        openLink.current = null
        void reporter.linkEnded({ ...link, endedBy: 'closed' })
      }
      if (practiceOwned.current !== null || log.current === null) return
      // A desktop tab keeps playing behind another, and that is still one listen.
      if (how === 'hidden' && engine.getState().playing) return
      log.flush(leftAs(how))
      log.playing(engine.getState().playing)
    })
    return () => {
      unsubscribeLeave()
      unsubscribeEnded()
      unsubscribeSystem()
      unsubscribe()
      log.drop()
      logRef.current = null
      reporterRef.current = null
      openLink.current = null
    }
  }, [db, engine, now, itemRef, originRef, analytics])

  const recordingId = item?.kind === 'recording' ? item.id : null
  const linkId = item?.kind === 'link' ? item.id : null
  useEffect(() => {
    const log = logRef.current
    if (!log) return
    const endedBy = itemRef.current === null ? 'closed' : 'skipped'
    const link = openLink.current
    if (link && link.linkId !== linkId) {
      openLink.current = null
      void reporterRef.current?.linkEnded({ ...link, endedBy })
    }
    if (linkId !== null && openLink.current === null) {
      openLink.current = { linkId, origin: originRef.current }
    }
    if (recordingId === log.current) return
    if (recordingId === null) {
      log.end(endedBy)
      return
    }
    lengthReady.current = engine.getState().lengthMs === 0
    log.start(recordingId, originRef.current)
  }, [recordingId, linkId, engine, itemRef, originRef])

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
        // Opening practice closes the play under way; the visit is a play of its own.
        if (handingOff.current) log.drop()
        else log.end('closed')
        handingOff.current = false
        if (loaded) {
          const state = engine.getState()
          log.start(id, PRACTICE_ORIGIN, heardLengthMs(state.lengthMs, state.speedPercent))
        } else {
          lengthReady.current = engine.getState().lengthMs === 0
          log.start(id, PRACTICE_ORIGIN)
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
      practiceClosed: (keep, leaving) => {
        const id = practiceOwned.current
        practiceOwned.current = null
        const log = logRef.current
        if (!log) return
        if (keep) log.end(leaving ? leftAs(leaving) : 'closed')
        else log.drop()
        handingOff.current = leaving !== undefined
        const current = itemRef.current
        if (id !== null && current?.kind === 'recording' && current.id === id) {
          resume(log, id, PLAYED_ON_ORIGIN)
        }
      },
      replayedByQueue: (replay) => {
        queueReplay.current = replay
        return () => {
          if (queueReplay.current === replay) queueReplay.current = null
        }
      },
    }
  }, [engine, itemRef])
}
