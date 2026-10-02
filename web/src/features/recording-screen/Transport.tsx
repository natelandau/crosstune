import { IonButton } from '@ionic/react'
import { Pause, Play, RotateCcw, RotateCw } from 'lucide-react'
import { PAUSE, PLAY } from '../player/Dock'
import { useEngineState, usePlaybackEngine } from '../player/PlaybackEngineProvider'

export const SKIP_BACK = 'Skip back 15 seconds'
export const SKIP_FORWARD = 'Skip forward 15 seconds'

/** The same interval the Apple player skips by. */
export const SKIP_MS = 15_000

/** Skip back, play and pause, and skip forward on the engine the dock loaded. */
export function Transport() {
  const engine = usePlaybackEngine()
  const playing = useEngineState(engine, (s) => s.playing)
  const loaded = useEngineState(engine, (s) => s.lengthMs > 0)
  return (
    <div className="flex items-center justify-center gap-6">
      <IonButton
        fill="clear"
        aria-label={SKIP_BACK}
        disabled={!loaded}
        onClick={() => engine.seek(engine.getState().positionMs - SKIP_MS)}
      >
        <RotateCcw aria-hidden="true" className="size-7" />
      </IonButton>
      <IonButton
        shape="round"
        className="size-16"
        aria-label={playing ? PAUSE : PLAY}
        disabled={!loaded}
        onClick={() => (playing ? engine.pause() : engine.play())}
      >
        {playing ? (
          <Pause aria-hidden="true" fill="currentColor" className="size-7" />
        ) : (
          <Play aria-hidden="true" fill="currentColor" className="ml-0.5 size-7" />
        )}
      </IonButton>
      <IonButton
        fill="clear"
        aria-label={SKIP_FORWARD}
        disabled={!loaded}
        onClick={() => engine.seek(engine.getState().positionMs + SKIP_MS)}
      >
        <RotateCw aria-hidden="true" className="size-7" />
      </IonButton>
    </div>
  )
}
