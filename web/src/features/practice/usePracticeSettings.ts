import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import { speedBucket } from '../../usage/buckets'
import { RECORDING_NOT_FOUND } from '../../commands/messages'
import { updateRecording } from '../../commands/recordings'
import { useDb } from '../../db/DbProvider'
import type { LocalRecording } from '../../db/types'
import { useLatest } from '../../ui/useLatest'
import {
  DEFAULT_ISOLATE,
  effectiveIsolate,
  isMonoFromRow,
  isolateEquals,
  isolateFromRow,
  isolateToPatch,
  type IsolateSetting,
} from '../player/isolate/isolateSetting'
import { useRowIsolate } from '../player/isolate/useRowIsolate'
import { usePlaybackEngine } from '../player/PlaybackEngineProvider'
import { usePracticeOverlay, type HeldSettings } from './usePracticeOverlay'
import { useSettledWrite } from './useSettledWrite'

const SPEED_NOT_SAVED = 'The speed could not be saved.'
const PITCH_NOT_SAVED = 'The pitch could not be saved.'
const ISOLATE_NOT_SAVED = 'The isolate setting could not be saved.'

/**
 * The recording's speed, pitch, and isolate setting as practice plays them: applied to the
 * engine at once, written once each settles, and held ahead of the row for the dock until the
 * writes land.
 */
export function usePracticeSettings({
  recording,
  onError,
  toast,
}: {
  recording: LocalRecording
  /** A refused write while practice shows; null clears it. */
  onError: (message: string | null) => void
  /** A refused write that lands after practice has closed. */
  toast: (message: string) => void
}): {
  speed: number
  pitch: number
  isolate: IsolateSetting
  changeSpeed: (percent: number) => void
  changePitch: (cents: number) => void
  changeIsolate: (setting: IsolateSetting) => void
} {
  const db = useDb()
  const engine = usePlaybackEngine()
  const analytics = useAnalytics()

  const rowSpeed = recording.speed_percent
  const rowPitch = recording.pitch_cents
  const rowIsolate = useRowIsolate(recording).setting
  const rowRef = useLatest(recording)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  // A write refused because the row is gone needs no word: practice goes with the row. Any
  // other refusal shows in practice, or as a toast once practice has closed.
  const reportSetting = (message: string) => (error: unknown) => {
    if (error instanceof Error && error.message === RECORDING_NOT_FOUND) return
    if (mounted.current) onError(message)
    else toast(message)
  }
  const writing = useRef(new Set<Promise<void>>())
  const write = (
    patch: { speed_percent: number } | { pitch_cents: number } | ReturnType<typeof isolateToPatch>,
    message: string,
    report: (recordingId: string) => void,
  ) => {
    const recordingId = rowRef.current.id
    // The report stays off the refusal path, so it can never show a saved value as unsaved.
    const done = updateRecording(db, recordingId, patch).then(
      () => report(recordingId),
      reportSetting(message),
    )
    writing.current.add(done)
    void done.finally(() => writing.current.delete(done))
  }
  // A value the row already holds, such as one adopted from another device, is not written back.
  const [speed, setSpeed] = useSettledSetting(rowSpeed, Object.is, (value) => {
    if (value === rowRef.current.speed_percent) return
    write({ speed_percent: value }, SPEED_NOT_SAVED, (id) =>
      analytics.send('speed_changed', {
        speed_bucket: speedBucket(value / 100),
        recording_id: id,
      }),
    )
  })
  const [pitch, setPitch] = useSettledSetting(rowPitch, Object.is, (value) => {
    if (value === rowRef.current.pitch_cents) return
    write({ pitch_cents: value }, PITCH_NOT_SAVED, (id) =>
      analytics.send('pitch_changed', { semitones: value / 100, recording_id: id }),
    )
  })
  const [isolate, setIsolate] = useSettledSetting(rowIsolate, isolateEquals, (value) => {
    if (isolateEquals(value, isolateFromRow(rowRef.current))) return
    const heard = effectiveIsolate(value, isMonoFromRow(rowRef.current))
    write(isolateToPatch(value), ISOLATE_NOT_SAVED, (id) =>
      analytics.send('isolate_changed', {
        effect: heard.effect,
        uses_stereo:
          heard.panStart !== DEFAULT_ISOLATE.panStart || heard.panEnd !== DEFAULT_ISOLATE.panEnd,
        uses_frequency:
          heard.lowHz !== DEFAULT_ISOLATE.lowHz || heard.highHz !== DEFAULT_ISOLATE.highHz,
        recording_id: id,
      }),
    )
  })

  const practiceOverlay = usePracticeOverlay()
  const recordingId = recording.id
  // Tells the dock what plays ahead of the row, so a stored value landing late re-applies
  // this view's value rather than the older one.
  const ownHold = useRef<HeldSettings | null>(null)
  useLayoutEffect(() => {
    const settings =
      speed === rowSpeed && pitch === rowPitch && isolateEquals(isolate, rowIsolate)
        ? null
        : {
            speedPercent: speed === rowSpeed ? null : speed,
            pitchCents: pitch === rowPitch ? null : pitch,
            isolate: isolateEquals(isolate, rowIsolate) ? null : isolate,
            trimming: false,
          }
    ownHold.current = settings
    practiceOverlay.hold(recordingId, settings)
  }, [practiceOverlay, recordingId, speed, pitch, isolate, rowSpeed, rowPitch, rowIsolate])

  // Declared after the settled writes, so their flush on leaving is already under way. The hold
  // outlives the view until every write has settled, so neither practice nor the dock shows
  // an older value landing first. A hold another view has taken since, such as the trim view's
  // taken in the same commit that unmounts this one, is left to it.
  useEffect(() => {
    const pending = writing.current
    const own = ownHold
    return () => {
      const left = own.current
      if (!left) return
      void Promise.allSettled([...pending]).then(() => {
        if (practiceOverlay.held(recordingId) === left) practiceOverlay.hold(recordingId, null)
      })
    }
  }, [practiceOverlay, recordingId])

  const changeSpeed = (percent: number) => {
    setSpeed(percent)
    onError(null)
    engine.setSpeed(percent)
  }
  const changePitch = (cents: number) => {
    setPitch(cents)
    onError(null)
    // Inside the tap that changed it, so iOS grants the audio context an audio stage needs.
    engine.setPitch(cents)
  }
  const changeIsolate = (setting: IsolateSetting) => {
    setIsolate(setting)
    onError(null)
    engine.setIsolate(setting, isMonoFromRow(rowRef.current))
  }
  return { speed, pitch, isolate, changeSpeed, changePitch, changeIsolate }
}

/**
 * A setting as the controls show it, which runs ahead of the row while a change settles and
 * follows the row when it changes while nothing is settling. `sent` is the last value written
 * or taken from the row: a value that differs from it holds a change of the musician's own,
 * which a row value landing meanwhile (such as this view's own earlier write) never undoes.
 * `write` runs once a change settles; `row` must keep its identity until its value changes.
 */
function useSettledSetting<T>(
  row: T,
  equals: (a: T, b: T) => boolean,
  write: (value: T) => void,
): [T, (value: T) => void] {
  const [value, setValue] = useState(row)
  const [sent, setSent] = useState(row)
  const [seenRow, setSeenRow] = useState(row)
  if (seenRow !== row) {
    setSeenRow(row)
    if (!equals(seenRow, row) && equals(value, sent)) {
      setValue(row)
      setSent(row)
    }
  }
  useSettledWrite(value, (settled) => {
    setSent(settled)
    write(settled)
  })
  return [value, setValue]
}
