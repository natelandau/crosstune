import { ZoomIn, ZoomOut } from 'lucide-react'
import { useLayoutEffect, useMemo, type RefObject } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import {
  PlaybackEngineContext,
  useEngineState,
  usePlaybackEngine,
} from '../player/PlaybackEngineProvider'
import type { PlaybackEngine } from '../player/playbackEngine'
import { isMonoFromRow } from '../player/isolate/isolateSetting'
import { FIT, LOCKED_LOOPS_NOTICE } from './practiceCopy'
import {
  PracticeLoopSwitcher,
  PracticeLoopsPanel,
  PracticeOverview,
  PracticeWaveformSlot,
} from './PracticeSurface'
import { slotProps, usePracticeCore } from './usePracticeCore'
import { usePracticeKeys, type PracticeKeyScope } from './usePracticeKeys'
import { usePracticeMode, type Mode } from './usePracticeMode'
import { usePracticeSettings } from './usePracticeSettings'
import { formatPreciseDuration } from '../../text/format'
import { clamp } from '../../math'
import { usePlayhead } from '../player/playheadClock'
import type { PracticeTimeline } from './usePracticeTimeline'
import { PRESS } from '../../ui/press'
import { ZOOM_IN, ZOOM_OUT, ZOOM_STEP } from './panel'
import { BUTTON_CORNER, BUTTON_TONE, UNFILLED_OFF } from '../../ui/buttonTone'
import type { ShownPeaks } from './recordingRange'
import type { RecordingView } from '../recordings/useRecordings'
import { isAppleTouch } from '../../platform/appleTouch'
import { useToast } from '../../ui/Toast'
import { ModePanel } from './ModePanel'
import { PracticeButton } from './PracticeButton'
import { useFrame } from '../../platform/frame'
import { TransportRow } from './TransportRow'

/** Where `PracticeView` leaves the control focus was on, for the next view to take up. */
export interface SavedFocus {
  peek: () => string | null
  keep: (key: string | null) => void
}

/** The controls under the waveform, capped so they stay in reach on a wide window. */
const CAPPED = 'mx-auto w-full max-w-xl'

interface PracticeViewProps {
  view: RecordingView
  /** The page's engine for the recording, from `useRecordingEngine`. */
  engine: PlaybackEngine
  /** Whether `engine` is the player's, holding the recording. */
  loaded: boolean
  /** The peaks for the recording's current trim range. */
  shown: ShownPeaks | null
  /** Why the waveform, transport, and modes cannot be used yet, such as a recording under way. */
  blocked?: string
  /** Set to what Escape does here; true when it did something. */
  escapeRef: RefObject<(() => boolean) | null>
  /**
   * The `data-focus-key` of the control focus was on when this view last unmounted, which a
   * fresh view puts focus back on as it mounts.
   */
  savedFocus: SavedFocus
  /** True while nothing sits over practice. */
  isTop: () => boolean
  /** Where its keys reach; left out, only practice itself. */
  keyScope?: PracticeKeyScope
  onError: (message: string | null) => void
}

/**
 * Practice's working view on jet: the overview, the waveform under a fixed playhead, the time
 * and zoom under it, the transport with the loop switcher, and the Loops, Speed, Pitch, and
 * Isolate panel. It owns the zoom and the keyboard.
 *
 * Everything under it drives `engine`: the player's while it has the recording loaded,
 * otherwise the page's own for the unloaded recording, so playback never changes, and Play
 * loads the recording at the playhead.
 */
export function PracticeView({ engine, loaded, ...props }: PracticeViewProps) {
  const stageUnavailable = useEngineState(usePlaybackEngine(), (s) => s.stageUnavailable)
  return (
    <PlaybackEngineContext.Provider value={engine}>
      <PracticeBody
        {...props}
        engine={engine}
        loaded={loaded}
        stageUnavailable={stageUnavailable}
      />
    </PlaybackEngineContext.Provider>
  )
}

function PracticeBody({
  view,
  shown,
  blocked,
  escapeRef,
  savedFocus,
  isTop,
  keyScope,
  onError,
  engine,
  loaded,
  stageUnavailable,
}: PracticeViewProps & {
  /** The device cannot build an audio stage, so pitch and isolate will not be heard. */
  stageUnavailable: boolean
}) {
  const { recording } = view

  const core = usePracticeCore({
    view,
    engine,
    onError,
    focusAdrift: (focused) => focused.matches('[role="dialog"]'),
  })
  const { timeline, loops, content, focusWaveform } = core

  const toast = useToast()
  const { speed, pitch, isolate, changeSpeed, changePitch, changeIsolate } = usePracticeSettings({
    recording,
    onError,
    toast: (message) => toast.show(message),
  })

  const [mode, setMode] = usePracticeMode()
  const chooseMode = (next: Mode) => {
    setMode(next)
    // Inside the tap, so iOS grants the audio context the Isolate panel's outline needs.
    if (next === 'isolate') engine.prime()
  }

  const ownScope = useMemo(() => ({ root: content }), [content])
  usePracticeKeys(escapeRef, { ...loops.keyActions, scope: keyScope ?? ownScope, isTop, blocked })

  // A list moving on remounts this view, Play and Next tune included, so focus follows the
  // control it was on into the new one within the same commit. The saved focus is spent on mount
  // whether or not it lands, so it can never pull focus back later.
  useLayoutEffect(() => {
    const root = content.current
    const key = savedFocus.peek()
    savedFocus.keep(null)
    if (key) root?.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`)?.focus()
    return () => {
      const focused = document.activeElement
      if (!(focused instanceof HTMLElement) || !root?.contains(focused)) return
      savedFocus.keep(focused.closest<HTMLElement>('[data-focus-key]')?.dataset.focusKey ?? null)
    }
  }, [content, savedFocus])

  const off = blocked ? 'pointer-events-none opacity-50' : ''
  const unusable = !timeline.loaded || !!blocked

  const phone = useFrame() === 'phone'
  const clock = blocked ?? <PlayheadTime timeline={timeline} />
  const zoom = (
    <div data-practice-zoom className="flex items-center">
      <PracticeButton
        icon={ZoomOut}
        iconClassName="size-5"
        label={ZOOM_OUT}
        isDisabled={!timeline.canZoomOut || !!blocked}
        onPress={() => timeline.zoom(1 / ZOOM_STEP)}
      />
      <AriaButton
        className={`t-body min-h-11 ${BUTTON_CORNER} px-2 font-semibold ${UNFILLED_OFF} ${PRESS} ${BUTTON_TONE.plain}`}
        isDisabled={!timeline.pxPerS || !!blocked}
        onPress={loops.fit}
      >
        {FIT}
      </AriaButton>
      <PracticeButton
        icon={ZoomIn}
        iconClassName="size-5"
        label={ZOOM_IN}
        isDisabled={!timeline.canZoomIn || !!blocked}
        onPress={() => timeline.zoom(ZOOM_STEP)}
      />
    </div>
  )

  return (
    <div ref={content} className="flex min-h-0 flex-1 flex-col gap-3">
      <PracticeOverview timeline={timeline} loops={loops} shown={shown} blocked={blocked} />
      <div data-waveform-slot className="relative">
        <PracticeWaveformSlot {...slotProps(core)} shown={shown} blocked={blocked} />
        {/* On a phone the zoom rides over the waveform's corner, as on iOS, so the clock takes a
            row of its own. */}
        {phone && (
          <div className="bg-page-translucent absolute right-0 bottom-0 z-30 rounded-(--radius-control)">
            {zoom}
          </div>
        )}
      </div>
      {phone ? (
        <p data-practice-clock className="t-heading t-num m-0 text-center">
          {clock}
        </p>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <p data-practice-clock className="t-timer t-num m-0">
            {clock}
          </p>
          {zoom}
        </div>
      )}
      <div data-practice-below className="flex shrink-0 flex-col gap-4">
        <div className={`${CAPPED} flex flex-col items-center gap-2`}>
          <TransportRow
            playing={timeline.playing}
            repeatName={loops.repeatName}
            // Play on a recording the player has not loaded loads it, its length known or not.
            disabled={loaded ? unusable : !!blocked}
            onTogglePlay={timeline.togglePlay}
            onSkip={timeline.skip}
            recordingId={recording.id}
          />
          <PracticeLoopSwitcher
            timeline={timeline}
            loops={loops}
            engine={engine}
            disabled={unusable}
          />
        </div>
        <div inert={!!blocked} className={`${CAPPED} ${off}`}>
          <ModePanel
            mode={mode}
            onMode={chooseMode}
            speedPercent={speed}
            pitchCents={pitch}
            onSpeed={changeSpeed}
            onPitch={changePitch}
            stageUnavailable={stageUnavailable}
            isolate={{
              value: isolate,
              isMono: isMonoFromRow(recording),
              onChange: changeIsolate,
              subscribeOutline: engine.subscribeIsolateOutline,
              recordingId: recording.id,
            }}
            loops={
              <PracticeLoopsPanel
                timeline={timeline}
                loops={loops}
                recordingId={recording.id}
                onError={onError}
                onRemoved={focusWaveform}
              />
            }
          />
        </div>
        {/* iOS suspends a page whose screen locks, and with it the timer that wraps a repeating loop. */}
        {isAppleTouch() ? (
          <p
            data-locked-loops
            aria-hidden={loops.selected ? undefined : 'true'}
            className={`t-secondary text-secondary m-0 text-center ${loops.selected ? '' : 'invisible'}`}
          >
            {LOCKED_LOOPS_NOTICE}
          </p>
        ) : null}
      </div>
      <p aria-live="polite" className="sr-only" data-practice-announcer>
        {timeline.announcement}
      </p>
    </div>
  )
}

/** The playhead's time to the tenth, which renders only when that text changes. */
function PlayheadTime({ timeline }: { timeline: PracticeTimeline }) {
  const { loaded, lengthMs } = timeline
  return usePlayhead(timeline.playhead, (ms) =>
    formatPreciseDuration(loaded ? clamp(ms, 0, lengthMs) : 0),
  )
}
