import { Repeat } from 'lucide-react'
import { REPEAT_LABEL } from '../player/transportCopy'
import { useEngineState, usePlaybackEngine } from '../player/PlaybackEngineProvider'
import { Transport } from '../recording-screen/Transport'
import type { LoopMark } from './useLoopMark'
import type { LoopPlayback } from './useLoopPlayback'
import { MARK_LOOP } from './practiceCopy'

/** What A B shows, with its pending face once a start is marked. */
export const MARK_FACE = 'A B'
export const MARK_PENDING_FACE = 'A…'
export const REPEAT = REPEAT_LABEL
export const REPEAT_NEEDS_LOOP = 'Select a loop first'
export const LOOP_START_MARKED = 'Loop start marked'
export const LOOP_CREATED = 'Loop created'

const SIDE_BUTTON =
  'type-headline grid size-11 shrink-0 place-items-center rounded-full disabled:opacity-40'
const OFF = 'bg-(--fill-tertiary)'
const ON = 'bg-(--ion-color-primary) text-(--ion-color-primary-contrast)'

/** The shared transport with A B on its left and Repeat on its right. */
export function PracticeTransport({ playback, mark }: { playback: LoopPlayback; mark: LoopMark }) {
  const engine = usePlaybackEngine()
  const loaded = useEngineState(engine, (s) => s.lengthMs > 0)
  // Only a recording too short to hold a loop has no reason to give, and then A B has no use.
  const showMark = mark.create.allowed || mark.create.reason !== null
  const noLoop = playback.selectedId === null
  return (
    <div className="flex items-center justify-center gap-4">
      {showMark ? (
        <button
          type="button"
          aria-label={MARK_LOOP}
          aria-pressed={mark.pending}
          title={mark.create.reason ?? undefined}
          disabled={!loaded || !mark.create.allowed}
          className={`${SIDE_BUTTON} ${mark.pending ? ON : OFF}`}
          // A click leaves focus where it was, so Space keeps playing and pausing rather
          // than pressing A B again; Tab still reaches it.
          onMouseDown={(event) => event.preventDefault()}
          onClick={mark.tap}
        >
          <span aria-hidden="true">{mark.pending ? MARK_PENDING_FACE : MARK_FACE}</span>
        </button>
      ) : (
        <span className="size-11 shrink-0" />
      )}
      <Transport />
      <button
        type="button"
        aria-label={REPEAT}
        aria-pressed={playback.repeat}
        title={noLoop ? REPEAT_NEEDS_LOOP : undefined}
        disabled={noLoop}
        className={`${SIDE_BUTTON} ${playback.repeat ? ON : OFF}`}
        onClick={playback.toggleRepeat}
      >
        <Repeat aria-hidden="true" className="size-5" />
      </button>
    </div>
  )
}
