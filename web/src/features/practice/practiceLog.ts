import { AudibleSpan } from '../player/activity'

/** Audio a practice session needs before it is written. */
export const PRACTICE_THRESHOLD_MS = 10_000
const DEFAULT_SPEED_PERCENT = 100
const DEFAULT_PITCH_CENTS = 0

export interface PracticeSettings {
  speedPercent: number
  pitchCents: number
}

/** One visit to practice that reached the threshold, timed on the injected clock. */
export interface PracticeRecord {
  recordingId: string
  startedAt: number
  durationMs: number
  loopIds: string[]
  speedPercent: number
  pitchCents: number
}

/** A visit that closed after sounding, as it is reported. */
export interface ClosedVisit {
  recordingId: string
  durationMs: number
  usedLoops: boolean
  /** Whether the speed was played, or only set, away from normal during the visit. */
  usedSpeed: boolean
  usedPitch: boolean
}

interface OpenSession {
  recordingId: string
  settings: PracticeSettings
  span: AudibleSpan
  durationMs: number
  loopIds: Set<string>
  speedMs: Map<number, number>
  pitchMs: Map<number, number>
  setSpeedOff: boolean
  setPitchOff: boolean
}

/** The key with the most time; the first to reach it wins a tie. */
function longest(times: Map<number, number>, fallback: number): number {
  let best = fallback
  let bestMs = -1
  for (const [value, ms] of times) {
    if (ms > bestMs) {
      best = value
      bestMs = ms
    }
  }
  return best
}

/**
 * Times one practice visit while audio plays, and the loops, speeds, and pitches it
 * played with. A visit that played a loop, or played any time away from the default speed or
 * pitch, is practice. Practice that sounded at all, kept or not, also goes to `onClosed`.
 */
export class PracticeLog {
  #open: OpenSession | null = null

  constructor(
    private readonly now: () => number,
    private readonly write: (record: PracticeRecord) => void,
    private readonly onClosed: (visit: ClosedVisit) => void = () => {},
  ) {}

  /** Starts a visit for `recordingId`, not yet playing, at the settings the engine holds. */
  open(recordingId: string, settings: PracticeSettings): void {
    this.#open = {
      recordingId,
      settings: { ...settings },
      span: new AudibleSpan(),
      durationMs: 0,
      loopIds: new Set(),
      speedMs: new Map(),
      pitchMs: new Map(),
      setSpeedOff: false,
      setPitchOff: false,
    }
  }

  playing(isPlaying: boolean): void {
    const open = this.#open
    if (!open) return
    if (isPlaying) open.span.start(this.now())
    else this.book(open, open.span.stop(this.now()))
  }

  usedLoop(id: string): void {
    this.#open?.loopIds.add(id)
  }

  setSpeed(percent: number): void {
    const open = this.#open
    if (!open || open.settings.speedPercent === percent) return
    this.book(open, open.span.take(this.now()))
    open.settings.speedPercent = percent
    if (percent !== DEFAULT_SPEED_PERCENT) open.setSpeedOff = true
  }

  setPitch(cents: number): void {
    const open = this.#open
    if (!open || open.settings.pitchCents === cents) return
    this.book(open, open.span.take(this.now()))
    open.settings.pitchCents = cents
    if (cents !== DEFAULT_PITCH_CENTS) open.setPitchOff = true
  }

  /**
   * Ends the visit. Writes a practice session and returns `'practice'` when it was practice with
   * enough audio; returns null when it was practice too short to keep, and `'play'` when it was
   * not practice, so the caller keeps the visit as an ordinary play instead.
   */
  close(): 'practice' | 'play' | null {
    const open = this.#open
    if (!open) return null
    this.playing(false)
    this.#open = null
    const playedSpeedOff = [...open.speedMs.keys()].some((speed) => speed !== DEFAULT_SPEED_PERCENT)
    const playedPitchOff = [...open.pitchMs.keys()].some((pitch) => pitch !== DEFAULT_PITCH_CENTS)
    if (open.loopIds.size === 0 && !playedSpeedOff && !playedPitchOff) return 'play'
    if (open.durationMs > 0) {
      this.onClosed({
        recordingId: open.recordingId,
        durationMs: open.durationMs,
        usedLoops: open.loopIds.size > 0,
        usedSpeed: playedSpeedOff || open.setSpeedOff,
        usedPitch: playedPitchOff || open.setPitchOff,
      })
    }
    const startedAt = open.span.startedAt
    if (startedAt === null || open.durationMs < PRACTICE_THRESHOLD_MS) return null
    this.write({
      recordingId: open.recordingId,
      startedAt,
      durationMs: open.durationMs,
      loopIds: [...open.loopIds],
      speedPercent: longest(open.speedMs, open.settings.speedPercent),
      pitchCents: longest(open.pitchMs, open.settings.pitchCents),
    })
    return 'practice'
  }

  /** Books `ms` of playing time to the settings in force over it. */
  private book(open: OpenSession, ms: number): void {
    if (ms <= 0) return
    open.durationMs += ms
    const { speedPercent, pitchCents } = open.settings
    open.speedMs.set(speedPercent, (open.speedMs.get(speedPercent) ?? 0) + ms)
    open.pitchMs.set(pitchCents, (open.pitchMs.get(pitchCents) ?? 0) + ms)
  }
}
