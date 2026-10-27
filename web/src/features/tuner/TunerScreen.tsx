import { useEffect, useState } from 'react'
import { RootBar } from '../../layout/RootBar'
import { PaneScroller } from '../../layout/pane'
import { useDocumentVisible } from '../../platform/visibility'
import { useWakeLock } from '../../platform/wakeLock'
import { useShellCovered } from '../../ui/overlayClaim'
import { useLatest } from '../../ui/useLatest'
import { useEngineState, usePlaybackEngine } from '../player/PlaybackEngineProvider'
import { usePlayer } from '../player/usePlayer'
import { useTunerSettings } from '../settings/useTunerSettings'
import { blend } from './blend'
import { inTuneFraction, isInTune } from './pitch/notes'
import type { Reading } from './pitch/tracker'
import { TunerBars } from './TunerBars'
import {
  formatCents,
  hintLabel,
  LISTENING,
  MIC_DENIED_BODY,
  MIC_DENIED_TITLE,
  MIC_UNAVAILABLE,
  referenceLabel,
  spokenReading,
  TAP_TO_LISTEN,
  TUNER_TITLE,
} from './tunerCopy'
import { useTuner, useTunerMicDeps } from './useTuner'

/** The shortest gap, in ms of input, between two announcements. */
const ANNOUNCE_GAP_MS = 1000

/** The Tuner destination's one pane: the note heard, how far off it is, and a bar at each side. */
export function TunerScreen() {
  const engine = usePlaybackEngine()
  const player = usePlayer()
  const playerRef = useLatest(player)
  useEffect(() => {
    // A recording pauses, never closes, so the queue and the now-playing card stay for the way
    // back. An embed's provider page offers no pause the app can reach, so it closes.
    if (engine.getState().playing) engine.pause()
    if (playerRef.current.item?.kind === 'link') playerRef.current.close()
  }, [engine, playerRef])
  const playing = useEngineState(engine, (state) => state.playing) || player.item?.kind === 'link'

  // The tuner is mounted only at its own route, so leaving it closes the microphone.
  const visible = useDocumentVisible()
  // A sheet or dialog stops listening; a menu or popover at its control does not.
  const covered = useShellCovered()
  useWakeLock(visible && !covered)
  // A play started here stops listening, since the microphone would hear it.
  const active = visible && !covered && !playing
  const { a4 } = useTunerSettings()
  const state = useTuner({ active, a4, deps: useTunerMicDeps() })
  const listening = active && state.status === 'listening'
  const reading = listening ? state.reading : null
  const shown = useHeldReading(reading, listening)
  const inTune = shown ? inTuneFraction(shown.note.cents) : 0
  const reference = referenceLabel(a4)

  return (
    <PaneScroller className="h-full overflow-y-auto">
      <main
        aria-label={TUNER_TITLE}
        data-pane-focus
        data-practice
        data-tuner
        className="bg-practice-background text-on-practice flex min-h-full flex-col transition-colors duration-(--dur-short) ease-(--ease)"
        style={{
          colorScheme: 'dark',
          backgroundColor:
            inTune > 0
              ? blend('--practice-background', '--tuner-in-tune-background', inTune)
              : undefined,
        }}
      >
        <RootBar title={TUNER_TITLE} />
        {reference && <p className="t-secondary text-on-practice-secondary px-4">{reference}</p>}
        <div
          data-tuner-stage
          data-status={state.status}
          data-in-tune-fraction={shown ? inTune : undefined}
          data-heard={reading !== null}
          className="relative min-h-72 flex-1"
        >
          {state.status === 'denied' ? (
            <Message title={MIC_DENIED_TITLE} body={MIC_DENIED_BODY} />
          ) : state.status === 'unavailable' ? (
            <Message body={MIC_UNAVAILABLE} />
          ) : state.status === 'paused' && active ? (
            <Message body={TAP_TO_LISTEN} />
          ) : (
            <>
              {shown && <TunerBars cents={shown.note.cents} />}
              {/* Remounted each time listening starts, so its announcements start fresh. */}
              {listening && <Readout reading={reading} shown={shown} />}
            </>
          )}
        </div>
      </main>
    </PaneScroller>
  )
}

function Message({ title, body }: { title?: string; body: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center">
      {title && <h2 className="t-heading">{title}</h2>}
      <p className="t-body text-on-practice-secondary">{body}</p>
    </div>
  )
}

interface Announced {
  key: string
  text: string
  atMs: number
}

/**
 * The reading as a screen reader hears it: spoken again only when the note or whether it is in
 * tune changes, and at most once a second of input, so a held note is not read out on every
 * update.
 */
function useAnnouncement(reading: Reading | null): string {
  const [announced, setAnnounced] = useState<Announced | null>(null)
  if (reading) {
    const { note, atMs } = reading
    const key = `${note.name}${note.octave}:${isInTune(note.cents)}`
    // Input time restarts with each opening of the microphone.
    const due = !announced || atMs < announced.atMs || atMs - announced.atMs >= ANNOUNCE_GAP_MS
    if (due && key !== announced?.key) {
      setAnnounced({ key, text: spokenReading(note), atMs })
    }
  }
  return announced?.text ?? ''
}

/**
 * The newest reading, held until the next one replaces it, since a plucked string decays before
 * the player looks up. Forgotten once listening stops, so the next session starts with the prompt.
 */
function useHeldReading(reading: Reading | null, listening: boolean): Reading | null {
  const [held, setHeld] = useState<Reading | null>(null)
  if (!listening) {
    if (held) setHeld(null)
    return null
  }
  if (reading && reading !== held) setHeld(reading)
  return reading ?? held
}

function Readout({ reading, shown }: { reading: Reading | null; shown: Reading | null }) {
  const spoken = useAnnouncement(reading)
  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        {spoken}
      </p>
      {shown ? (
        // The note sits on the stage's middle, level with in-tune bars; the cents hang below it.
        <div
          aria-hidden
          className="absolute inset-0 grid grid-rows-[1fr_auto_1fr] justify-items-center"
        >
          <p className="row-start-2 m-0 flex items-baseline text-[7rem] leading-none font-light">
            {shown.note.name}
            <span className="text-[2.5rem]">{shown.note.octave}</span>
          </p>
          <div className="row-start-3 flex flex-col items-center gap-2 pt-2">
            <p className="t-heading t-num m-0">{formatCents(shown.note.cents)}</p>
            <p className="t-body text-on-practice-secondary m-0">{hintLabel(shown.note.cents)}</p>
          </div>
        </div>
      ) : (
        <p className="t-body text-on-practice-secondary absolute inset-0 m-0 flex items-center justify-center">
          {LISTENING}
        </p>
      )}
    </>
  )
}
