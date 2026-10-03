import { IonLabel, IonSegment, IonSegmentButton } from '@ionic/react'
import type { ReactNode } from 'react'
import { PITCH_BADGE, SPEED_BADGE } from '../player/transportCopy'
import { PITCH, PitchPanel } from '../recording-screen/PitchPanel'
import { SPEED, SpeedPanel } from '../recording-screen/SpeedPanel'
import { LOOPS_LABEL, SEGMENT_LABEL } from './practiceCopy'
import { MODES, type Mode } from './usePracticeMode'

/** Loops, Speed, and Pitch as one segmented control, with Speed and Pitch off default shown. */
export function ModeSelector({
  mode,
  onMode,
  speedPercent,
  pitchCents,
}: {
  mode: Mode
  onMode: (mode: Mode) => void
  speedPercent: number
  pitchCents: number
}) {
  const labels: Record<Mode, string> = {
    loops: LOOPS_LABEL,
    speed: SEGMENT_LABEL(SPEED, speedPercent !== 100 ? SPEED_BADGE(speedPercent) : null),
    pitch: SEGMENT_LABEL(PITCH, pitchCents !== 0 ? PITCH_BADGE(pitchCents) : null),
  }
  return (
    <IonSegment
      data-mode-selector
      value={mode}
      onIonChange={(event) => {
        const next = MODES.find((m) => m === event.detail.value)
        if (next) onMode(next)
      }}
    >
      {MODES.map((m) => (
        <IonSegmentButton key={m} value={m}>
          <IonLabel>{labels[m]}</IonLabel>
        </IonSegmentButton>
      ))}
    </IonSegment>
  )
}

/**
 * The chosen mode's own controls, which the screen places apart from its selector. Every panel
 * stays mounted in one grid cell with only the chosen one shown, so the block is always as tall
 * as the tallest and switching modes never moves what is above it.
 */
export function ModeControls({
  mode,
  speedPercent,
  pitchCents,
  onSpeed,
  onPitch,
  pitchUnavailable = false,
  loops,
}: {
  mode: Mode
  speedPercent: number
  pitchCents: number
  onSpeed: (percent: number) => void
  onPitch: (cents: number) => void
  pitchUnavailable?: boolean
  /** The Loops mode's panel. */
  loops: ReactNode
}) {
  const panels: Record<Mode, ReactNode> = {
    loops,
    speed: <SpeedPanel value={speedPercent} onChange={onSpeed} />,
    pitch: <PitchPanel value={pitchCents} onChange={onPitch} unavailable={pitchUnavailable} />,
  }
  return (
    <div data-mode-controls className="grid">
      {MODES.map((m) => (
        <div
          key={m}
          data-mode-panel={m}
          inert={m !== mode}
          aria-hidden={m === mode ? undefined : 'true'}
          className={`[grid-area:1/1] ${m === mode ? '' : 'invisible'}`}
        >
          {panels[m]}
        </div>
      ))}
    </div>
  )
}
