import { useRef, type RefObject } from 'react'
import { useElementSize } from '../../ui/useElementSize'
import type { PlaybackEngine } from '../player/playbackEngine'
import { useZoomGestures } from './useZoomGestures'
import type { RecordingView } from '../recordings/useRecordings'
import { LANES_LABEL } from './practiceCopy'
import { usePracticeLoops, type PracticeLoops } from './usePracticeLoops'
import { usePracticeTimeline, type PracticeTimeline } from './usePracticeTimeline'

/** Practice's timeline and loops, with the elements the view hangs them on. */
export interface PracticeCore {
  /** On the view's root, which the focus fallbacks search. */
  content: RefObject<HTMLDivElement | null>
  /** On the waveform's slot, whose measured size sets the scale. */
  slot: RefObject<HTMLDivElement | null>
  size: { width: number; height: number }
  timeline: PracticeTimeline
  loops: PracticeLoops
  /** Counts pinches, so a loop drag that gave way to one writes nothing. */
  pinches: RefObject<number>
  /** The pinch and wheel zoom handlers, spread on the slot. */
  pinch: ReturnType<typeof useZoomGestures>
  focusWaveform: () => void
}

/**
 * The timeline, loops, and zoom gestures every practice view shares. The timeline and loops
 * hooks set state while rendering, so they live together here. `focusAdrift` says whether focus
 * sits on practice's own container rather than a control, where a closed name field leaves it.
 */
export function usePracticeCore({
  view,
  engine,
  onError,
  focusAdrift,
}: {
  view: RecordingView
  engine: PlaybackEngine
  onError: (message: string | null) => void
  focusAdrift: (focused: Element) => boolean
}): PracticeCore {
  // The zoom is a scale only: the playhead is always the view's center.
  const slot = useRef<HTMLDivElement>(null)
  const size = useElementSize(slot)
  const timeline = usePracticeTimeline({ view, engine, size })

  const content = useRef<HTMLDivElement>(null)
  const focusWaveform = () =>
    content.current
      ?.querySelector<HTMLElement>(`[role="slider"][aria-label="${LANES_LABEL}"]`)
      ?.focus()
  const loops = usePracticeLoops({
    view,
    timeline,
    announce: timeline.announce,
    onError,
    // Delete goes disabled with the loop, which would drop focus onto the page.
    onRemoved: focusWaveform,
    // Focus a closed name field left on nothing goes back to the loop's name tab.
    onRenameEnd: (id) =>
      requestAnimationFrame(() => {
        const focused = document.activeElement
        if (focused && focused !== document.body && !focusAdrift(focused)) return
        content.current
          ?.querySelector<HTMLElement>(`button[data-name-tab="${CSS.escape(id)}"]`)
          ?.focus()
      }),
  })

  const pinches = useRef(0)
  const pinch = useZoomGestures(slot, (action) => timeline.zoom(action.factor), {
    onFirstPointer: () => {},
    onPinchStart: () => {
      pinches.current += 1
    },
  })

  return { content, slot, size, timeline, loops, pinches, pinch, focusWaveform }
}

/** What `PracticeWaveformSlot` takes from the core, its slot ref under the name the prop uses. */
export function slotProps(core: PracticeCore) {
  return {
    timeline: core.timeline,
    loops: core.loops,
    size: core.size,
    slotRef: core.slot,
    pinch: core.pinch,
    pinches: core.pinches,
  }
}
