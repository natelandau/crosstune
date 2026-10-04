import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { RECORDING_NOT_FOUND } from '../../commands/messages'
import { updateRecording } from '../../commands/recordings'
import { useDb } from '../../db/DbProvider'
import type { LocalRecording } from '../../db/types'
import { useToast } from '../../ui/Toast'
import { useLatest } from '../../ui/useLatest'
import { usePlaybackEngine } from '../player/PlaybackEngineProvider'
import { useRecordingScreen, type HeldSettings } from '../recording-screen/useRecordingScreen'
import { useSettledWrite } from '../recording-screen/useSettledWrite'

export const SPEED_NOT_SAVED = 'The speed could not be saved.'
export const PITCH_NOT_SAVED = 'The pitch could not be saved.'

/**
 * The recording's speed and pitch as the screen plays them: applied to the engine at once,
 * written once each settles, and held ahead of the row for the dock until the writes land.
 */
export function usePracticeSettings({
  recording,
  onError,
}: {
  recording: LocalRecording
  /** A refused write while the screen shows; null clears it. */
  onError: (message: string | null) => void
}): {
  speed: number
  pitch: number
  changeSpeed: (percent: number) => void
  changePitch: (cents: number) => void
} {
  const db = useDb()
  const engine = usePlaybackEngine()
  const toast = useToast()

  // What the controls show runs ahead of the row while a change settles, and follows the row
  // when it changes while nothing is settling. `sent` is the last value this view wrote or
  // took from the row: a control that differs from it holds a change of the musician's own,
  // which a row value landing meanwhile (such as this view's own earlier write) never undoes.
  const [speed, setSpeed] = useState(recording.speed_percent)
  const [pitch, setPitch] = useState(recording.pitch_cents)
  const [sent, setSent] = useState({ speed: recording.speed_percent, pitch: recording.pitch_cents })
  const [rowSettings, setRowSettings] = useState({
    speed: recording.speed_percent,
    pitch: recording.pitch_cents,
  })
  const rowSpeed = recording.speed_percent
  const rowPitch = recording.pitch_cents
  if (rowSettings.speed !== rowSpeed || rowSettings.pitch !== rowPitch) {
    setRowSettings({ speed: rowSpeed, pitch: rowPitch })
    const adoptSpeed = rowSettings.speed !== rowSpeed && speed === sent.speed
    const adoptPitch = rowSettings.pitch !== rowPitch && pitch === sent.pitch
    if (adoptSpeed) setSpeed(rowSpeed)
    if (adoptPitch) setPitch(rowPitch)
    if (adoptSpeed || adoptPitch) {
      setSent({
        speed: adoptSpeed ? rowSpeed : sent.speed,
        pitch: adoptPitch ? rowPitch : sent.pitch,
      })
    }
  }

  const recordingScreen = useRecordingScreen()
  const recordingId = recording.id
  // Tells the dock what plays ahead of the row, so a stored value landing late re-applies
  // this view's value rather than the older one.
  const ownHold = useRef<HeldSettings | null>(null)
  useLayoutEffect(() => {
    const settings =
      speed === rowSpeed && pitch === rowPitch
        ? null
        : {
            speedPercent: speed === rowSpeed ? null : speed,
            pitchCents: pitch === rowPitch ? null : pitch,
            trimming: false,
          }
    ownHold.current = settings
    recordingScreen.hold(recordingId, settings)
  }, [recordingScreen, recordingId, speed, pitch, rowSpeed, rowPitch])

  const rowRef = useLatest(recording)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  // A write refused because the row is gone needs no word: the screen goes with the row. Any
  // other refusal shows on the screen, or as a toast once the screen has closed.
  const reportSetting = (message: string) => (error: unknown) => {
    if (error instanceof Error && error.message === RECORDING_NOT_FOUND) return
    if (mounted.current) onError(message)
    else toast({ message })
  }
  const writing = useRef(new Set<Promise<void>>())
  const write = (patch: { speed_percent: number } | { pitch_cents: number }, message: string) => {
    const done = updateRecording(db, rowRef.current.id, patch).catch(reportSetting(message))
    writing.current.add(done)
    void done.finally(() => writing.current.delete(done))
  }
  // A value the row already holds, such as one adopted from another device, is not written back.
  useSettledWrite(speed, (value) => {
    setSent((current) => ({ ...current, speed: value }))
    if (value === rowRef.current.speed_percent) return
    write({ speed_percent: value }, SPEED_NOT_SAVED)
  })
  useSettledWrite(pitch, (value) => {
    setSent((current) => ({ ...current, pitch: value }))
    if (value === rowRef.current.pitch_cents) return
    write({ pitch_cents: value }, PITCH_NOT_SAVED)
  })
  // Declared after the settled writes, so their flush on leaving is already under way. The hold
  // outlives the view until every write has settled, so neither the screen nor the dock shows
  // an older value landing first. A hold another view has taken since, such as the trim view's
  // taken in the same commit that unmounts this one, is left to it.
  useEffect(() => {
    const pending = writing.current
    const own = ownHold
    return () => {
      const left = own.current
      if (!left) return
      void Promise.allSettled([...pending]).then(() => {
        if (recordingScreen.held(recordingId) === left) recordingScreen.hold(recordingId, null)
      })
    }
  }, [recordingScreen, recordingId])

  const changeSpeed = (percent: number) => {
    setSpeed(percent)
    onError(null)
    engine.setSpeed(percent)
  }
  const changePitch = (cents: number) => {
    setPitch(cents)
    onError(null)
    // Inside the tap that changed it, so iOS grants the audio context a pitch stage needs.
    engine.setPitch(cents)
  }
  return { speed, pitch, changeSpeed, changePitch }
}
