import type { ReactNode } from 'react'
import { PitchPanel } from './PitchPanel'
import { SpeedPanel } from './SpeedPanel'
import { MODES, type Mode } from './usePracticeMode'

/**
 * The chosen mode's own controls, which practice places apart from its selector. Every panel
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
  lockNotice = false,
  loops,
}: {
  mode: Mode
  speedPercent: number
  pitchCents: number
  onSpeed: (percent: number) => void
  onPitch: (cents: number) => void
  pitchUnavailable?: boolean
  /** Whether the Pitch panel says that pitch-shifted playback pauses when the screen locks. */
  lockNotice?: boolean
  /** The Loops mode's panel. */
  loops: ReactNode
}) {
  const panels: Record<Mode, ReactNode> = {
    loops,
    speed: <SpeedPanel value={speedPercent} onChange={onSpeed} />,
    pitch: (
      <PitchPanel
        value={pitchCents}
        onChange={onPitch}
        unavailable={pitchUnavailable}
        lockNotice={lockNotice}
      />
    ),
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
