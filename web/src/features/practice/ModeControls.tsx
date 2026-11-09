import { useEffect, useState, type ReactNode } from 'react'
import type { IsolateOutline } from '../player/isolate/isolateStage'
import type { IsolateSetting } from '../player/isolate/isolateSetting'
import { IsolatePanel } from './IsolatePanel'
import { createOutlineFeed } from './isolateOutlineFeed'
import { PitchPanel } from './PitchPanel'
import { SpeedPanel } from './SpeedPanel'
import { availableModes, type Mode } from './usePracticeMode'

/** What the Isolate mode needs from the recording it plays. */
export interface IsolateControls {
  value: IsolateSetting
  isMono: boolean
  onChange: (setting: IsolateSetting) => void
  subscribeOutline: (fn: (outline: IsolateOutline) => void) => () => void
  /** The outline drawn belongs to this recording, and drops when it changes. */
  recordingId: string
}

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
  stageUnavailable = false,
  lockNotice = false,
  isolate = null,
  loops,
  only = false,
}: {
  mode: Mode
  speedPercent: number
  pitchCents: number
  onSpeed: (percent: number) => void
  onPitch: (cents: number) => void
  /** The engine could not build its audio stage, which runs pitch and isolate both. */
  stageUnavailable?: boolean
  /** Whether Pitch and Isolate say that their playback pauses when the screen locks. */
  lockNotice?: boolean
  /** Null where nothing can isolate, which leaves the Isolate mode out. */
  isolate?: IsolateControls | null
  /** The Loops mode's panel. */
  loops: ReactNode
  /** Lays out only the chosen mode's controls, for a popover that holds one mode. */
  only?: boolean
}) {
  const panels: Record<Mode, ReactNode> = {
    loops,
    speed: <SpeedPanel value={speedPercent} onChange={onSpeed} />,
    pitch: (
      <PitchPanel
        value={pitchCents}
        onChange={onPitch}
        unavailable={stageUnavailable}
        lockNotice={lockNotice}
      />
    ),
    isolate: isolate ? (
      // A panel per recording, so another recording's outline never shows.
      <LiveIsolatePanel
        key={isolate.recordingId}
        isolate={isolate}
        shown={mode === 'isolate'}
        unavailable={stageUnavailable}
        lockNotice={lockNotice}
      />
    ) : null,
  }
  if (only) return <div data-mode-panel={mode}>{panels[mode]}</div>
  return (
    <div data-mode-controls className="grid">
      {availableModes(isolate !== null).map((m) => (
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

/** The Isolate panel with the engine's outline, followed only while the panel shows. */
function LiveIsolatePanel({
  isolate,
  shown,
  unavailable,
  lockNotice,
}: {
  isolate: IsolateControls
  shown: boolean
  unavailable: boolean
  lockNotice: boolean
}) {
  const { subscribeOutline } = isolate
  const [outline] = useState(createOutlineFeed)
  useEffect(() => {
    if (!shown) return
    return subscribeOutline(outline.push)
  }, [shown, subscribeOutline, outline])
  return (
    <IsolatePanel
      value={isolate.value}
      isMono={isolate.isMono}
      unavailable={unavailable}
      lockNotice={lockNotice}
      outline={outline}
      onChange={isolate.onChange}
    />
  )
}
