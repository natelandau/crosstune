import { ZoomIn, ZoomOut } from 'lucide-react'
import { useLayoutEffect, type RefObject } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import { useEngineState, usePlaybackEngine } from '../player/PlaybackEngineProvider'
import { FIT, LOCKED_LOOPS_NOTICE } from './practiceCopy'
import {
  PracticeLoopSwitcher,
  PracticeLoopsPanel,
  PracticeOverview,
  PracticeWaveformSlot,
} from './PracticeSurface'
import { slotProps, usePracticeCore } from './usePracticeCore'
import { usePracticeKeys } from './usePracticeKeys'
import { usePracticeMode } from './usePracticeMode'
import { usePracticeSettings } from './usePracticeSettings'
import { formatPreciseDuration } from '../recording/format'
import { ZOOM_IN, ZOOM_OUT, ZOOM_STEP } from './panel'
import type { ShownPeaks } from './recordingRange'
import type { RecordingView } from '../recordings/useRecordings'
import { isAppleTouch } from '../../platform/appleTouch'
import { useToast } from '../../ui/Toast'
import { ModePanel } from './ModePanel'
import { PracticeButton } from './PracticeButton'
import { TransportRow } from './TransportRow'

/** Where `PracticeView` leaves the control focus was on, for the next view to take up. */
export interface FocusCarry {
  peek: () => string | null
  keep: (key: string | null) => void
}

/** The controls under the waveform, capped so they stay in reach on a wide window. */
const CAPPED = 'mx-auto w-full max-w-xl'

/**
 * Practice's working view on jet: the overview, the waveform under a fixed playhead, the time
 * and zoom under it, the transport with the loop switcher, and the Loops, Speed, and Pitch
 * panel. It drives the engine the bar loaded and owns the zoom and the keyboard.
 */
export function PracticeView({
  view,
  shown,
  blocked,
  escapeRef,
  focusCarry,
  isTop,
  onError,
}: {
  view: RecordingView
  /** The peaks for the recording's current trim range. */
  shown: ShownPeaks | null
  /** Why the waveform, transport, and modes cannot be used yet, such as a take still recording. */
  blocked?: string
  /** Set to what Escape does here before practice closes; true when it did something. */
  escapeRef: RefObject<(() => boolean) | null>
  /**
   * The `data-focus-key` of the control focus was on when this view last unmounted, which a
   * fresh view puts focus back on as it mounts.
   */
  focusCarry: FocusCarry
  /** True while practice is the overlay on top. */
  isTop: () => boolean
  onError: (message: string | null) => void
}) {
  const { recording } = view
  const engine = usePlaybackEngine()
  const pitchUnavailable = useEngineState(engine, (s) => s.pitchUnavailable)

  const core = usePracticeCore({
    view,
    engine,
    onError,
    focusAdrift: (focused) => focused.matches('[role="dialog"]'),
  })
  const { timeline, loops, content, focusWaveform } = core

  const toast = useToast()
  const { speed, pitch, changeSpeed, changePitch } = usePracticeSettings({
    recording,
    onError,
    toast: (message) => toast.show(message),
  })

  const [mode, setMode] = usePracticeMode()

  usePracticeKeys(escapeRef, { ...loops.keyActions, isTop, blocked })

  // A list moving on remounts this view, Play and Next tune included, so focus follows the
  // control it was on into the new one within the same commit. The carry is spent on mount
  // whether or not it lands, so it can never pull focus back later.
  useLayoutEffect(() => {
    const root = content.current
    const key = focusCarry.peek()
    focusCarry.keep(null)
    if (key) root?.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`)?.focus()
    return () => {
      const focused = document.activeElement
      if (!(focused instanceof HTMLElement) || !root?.contains(focused)) return
      focusCarry.keep(focused.closest<HTMLElement>('[data-focus-key]')?.dataset.focusKey ?? null)
    }
  }, [content, focusCarry])

  const off = blocked ? 'pointer-events-none opacity-50' : ''
  const unusable = !timeline.loaded || !!blocked

  return (
    <div ref={content} className="flex min-h-0 flex-1 flex-col gap-3">
      <PracticeOverview timeline={timeline} loops={loops} shown={shown} blocked={blocked} />
      <PracticeWaveformSlot {...slotProps(core)} shown={shown} blocked={blocked} />
      <div className="flex items-center justify-between gap-2">
        <p data-practice-clock className="t-timer t-num m-0">
          {blocked ?? formatPreciseDuration(timeline.shownMs)}
        </p>
        <div data-practice-zoom className="flex items-center">
          <PracticeButton
            icon={ZoomOut}
            iconClassName="size-5"
            label={ZOOM_OUT}
            isDisabled={!timeline.canZoomOut || !!blocked}
            onPress={() => timeline.zoom(1 / ZOOM_STEP)}
          />
          <AriaButton
            className="t-body min-h-11 px-2 font-semibold text-(--panel-ink) disabled:opacity-40 data-[pressed]:opacity-60"
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
      </div>
      {/* Scrolls only when the waveform is down to its floor, such as on a landscape phone. */}
      <div data-practice-below className="flex min-h-16 shrink flex-col gap-4 overflow-y-auto">
        <div className={`${CAPPED} flex flex-col items-center gap-2`}>
          <TransportRow
            playing={timeline.playing}
            repeatName={loops.repeatName}
            disabled={unusable}
            onTogglePlay={timeline.togglePlay}
            onSkip={timeline.skip}
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
            onMode={setMode}
            speedPercent={speed}
            pitchCents={pitch}
            onSpeed={changeSpeed}
            onPitch={changePitch}
            pitchUnavailable={pitchUnavailable}
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
            className={`t-secondary m-0 text-center text-(--panel-muted) ${loops.selected ? '' : 'invisible'}`}
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
