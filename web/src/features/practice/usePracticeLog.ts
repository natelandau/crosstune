import { useContext, useEffect } from 'react'
import { useAnalytics } from '../../analytics/AnalyticsProvider'
import { createPlaybackReporter, playedRows } from '../../analytics/playbackReporter'
import { recordEvent } from '../../commands/events'
import { newId } from '../../commands/write'
import { DbContext } from '../../db/DbProvider'
import type { CrosstuneDb } from '../../db/schema'
import { iso, onPageLeave, type PageLeave } from '../player/activity'
import { usePlaybackEngine } from '../player/PlaybackEngineProvider'
import type { PlaybackState } from '../player/playbackEngine'
import { usePlayLogControl } from '../player/usePlayLog'
import type { PracticeOverlayHandle } from './usePracticeOverlay'
import { PracticeLog, type PracticeRecord } from './practiceLog'

async function recordPractice(
  db: CrosstuneDb,
  record: PracticeRecord,
  createdAt: number,
): Promise<void> {
  const recording = await db.recordings.get(record.recordingId)
  await recordEvent(db, 'practice_sessions', {
    id: newId(),
    recording_id: record.recordingId,
    tune_id: recording?.tune_id ?? null,
    started_at: iso(record.startedAt),
    duration_ms: record.durationMs,
    loop_ids: record.loopIds,
    speed_percent: record.speedPercent,
    pitch_cents: record.pitchCents,
    created_at: iso(createdAt),
  })
}

/**
 * Logs each visit to practice for `recordingId` (null while it is closed) as a
 * practice session, or hands it back to the play log as an ordinary play. A visit also ends when
 * the page goes away or is hidden while paused, since the page may never come back; practice
 * still open then starts a fresh one.
 */
export function usePracticeLog(
  recordingId: string | null,
  overlay: Pick<PracticeOverlayHandle, 'held' | 'subscribe'>,
  { now = Date.now }: { now?: () => number } = {},
): void {
  const engine = usePlaybackEngine()
  const playLog = usePlayLogControl()
  const db = useContext(DbContext)
  const analytics = useAnalytics()
  const { held, subscribe } = overlay

  useEffect(() => {
    if (recordingId === null) return
    const reporter = createPlaybackReporter(analytics, db ? playedRows(db) : null)
    const log = new PracticeLog(
      now,
      (record) => {
        // A lost session is not worth interrupting the musician over.
        if (db) void recordPractice(db, record, now()).catch(() => {})
      },
      (visit) => void reporter.practiceEnded(visit),
    )
    // The trim view forces 100% and no shift so what is heard is what is cut. That is neither
    // practice nor a listen, so its time counts toward nothing.
    const trimming = () => held(recordingId)?.trimming === true
    let prev: PlaybackState = engine.getState()
    // Whether this recording's audio is playing. Until it is loaded, the engine is still
    // reporting the recording before it, so only a change of `playing` after this opens counts.
    let playing = false

    const feed = () => {
      const state = engine.getState()
      const loaded = playLog.practiceLoaded()
      if (loaded) {
        log.setSpeed(state.speedPercent)
        log.setPitch(state.pitchCents)
      }
      const audible = loaded && playing && !trimming()
      log.playing(audible)
      playLog.practicePlaying(audible)
      if (audible && state.repeat && state.loop) log.usedLoop(state.loop.id)
    }
    const begin = () => {
      const loaded = playLog.practiceOpened(recordingId)
      const state = engine.getState()
      log.open(recordingId, { speedPercent: state.speedPercent, pitchCents: state.pitchCents })
      if (loaded) playing = state.playing
      feed()
    }
    const finish = (leaving?: PageLeave) => playLog.practiceClosed(log.close() === 'play', leaving)

    begin()
    const unsubscribeEngine = engine.subscribe((state) => {
      if (state.playing !== prev.playing) playing = state.playing
      prev = state
      feed()
    })
    const unsubscribeHeld = subscribe(feed)
    const unsubscribeLeave = onPageLeave((how) => {
      // A desktop tab keeps playing behind another, and that is still one visit.
      if (how === 'hidden' && engine.getState().playing) return
      finish(how)
      begin()
    })
    return () => {
      unsubscribeLeave()
      unsubscribeHeld()
      unsubscribeEngine()
      finish()
    }
  }, [recordingId, db, now, engine, playLog, held, subscribe, analytics])
}
