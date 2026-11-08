import { motion } from 'motion/react'
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ToggleButton } from 'react-aria-components'
import { ModeControls, type IsolateControls } from './ModeControls'
import { SegmentedChoice } from '../../ui/SegmentedChoice'
import { SEGMENT_PILL, SEGMENT_TEXT } from '../../ui/segmentedTrack'
import { MODE_NAMES, useModeLabels } from './useModeLabels'
import { MODES_LABEL } from './practiceCopy'
import { DEFAULT_ISOLATE, effectiveIsolate } from '../player/isolate/isolateSetting'
import { availableModes, type Mode } from './usePracticeMode'
import { isAppleTouch } from '../../platform/appleTouch'

/**
 * Speed, Pitch, Isolate, and Loops as one segmented choice over the chosen mode's controls.
 * Every mode's controls stay laid out, so the panel holds the height of the tallest.
 */
export function ModePanel({
  mode,
  onMode,
  speedPercent,
  pitchCents,
  onSpeed,
  onPitch,
  stageUnavailable,
  isolate,
  loops,
}: {
  mode: Mode
  onMode: (mode: Mode) => void
  speedPercent: number
  pitchCents: number
  onSpeed: (percent: number) => void
  onPitch: (cents: number) => void
  stageUnavailable: boolean
  /** Null where nothing can isolate, such as a streaming link, which leaves Isolate out. */
  isolate: IsolateControls | null
  /** The Loops mode's panel. */
  loops: ReactNode
}) {
  const labels = useModeLabels(
    speedPercent,
    pitchCents,
    isolate ? effectiveIsolate(isolate.value, isolate.isMono) : DEFAULT_ISOLATE,
  )
  const modes = availableModes(isolate !== null)
  // A mode this item does not offer, such as one kept from a recording, opens on Speed.
  const shown = modes.includes(mode) ? mode : 'speed'
  const selector = useRef<HTMLDivElement>(null)
  const fits = useValueLabelsFit(selector, modes.join(' '))
  return (
    <div data-mode-panel-root className="flex flex-col gap-3">
      <SegmentedChoice
        ref={selector}
        data-mode-selector
        label={MODES_LABEL}
        options={modes}
        selected={shown}
        onChange={onMode}
      >
        {modes.map((m) => (
          <ToggleButton
            key={m}
            id={m}
            // The name keeps the value whichever label shows, so it never changes with the width.
            aria-label={labels[m]}
            className={`t-body t-num ${SEGMENT_TEXT} relative min-h-(--target) flex-1 cursor-default overflow-hidden rounded-(--radius-capsule) px-2 transition-colors duration-(--dur-short) ease-(--ease) data-[selected]:delay-(--dur-short)`}
          >
            {/* One pill shared across the modes, so choosing a mode slides it there. */}
            {m === shown && (
              <motion.span
                layoutId="practice-mode-pill"
                aria-hidden
                className={`${SEGMENT_PILL} absolute inset-0 z-0 rounded-(--radius-capsule)`}
              />
            )}
            {/* Above the pill as it slides past, and darkening as it arrives rather than before. */}
            <span className="relative z-10">{fits ? labels[m] : MODE_NAMES[m]}</span>
            {/* The value label on one line, measured in place of the shown one, which it never
                replaces, so the switch cannot feed back into the measure. */}
            <span
              data-value-label
              aria-hidden
              className="pointer-events-none invisible absolute top-0 left-0 whitespace-nowrap"
            >
              {labels[m]}
            </span>
          </ToggleButton>
        ))}
      </SegmentedChoice>
      <ModeControls
        mode={shown}
        speedPercent={speedPercent}
        pitchCents={pitchCents}
        onSpeed={onSpeed}
        onPitch={onPitch}
        stageUnavailable={stageUnavailable}
        // Safari suspends the Web Audio graph that shifts pitch and isolates once the phone locks.
        lockNotice={isAppleTouch()}
        isolate={isolate}
        loops={loops}
      />
    </div>
  )
}

/**
 * Whether every segment's value label fits its segment on one line. When one does not, every
 * segment shows its plain name, and each panel still shows its value.
 */
function useValueLabelsFit(
  selector: RefObject<HTMLDivElement | null>,
  /** The modes offered, whose segments the copies sit in. A changed label resizes its copy,
   * which the observer measures. */
  modes: string,
): boolean {
  const [fits, setFits] = useState(true)
  useLayoutEffect(() => {
    const root = selector.current
    if (!root) return
    const copies = [...root.querySelectorAll<HTMLElement>('[data-value-label]')]
    const measure = () => {
      setFits(
        copies.every((copy) => {
          const segment = copy.parentElement!
          const style = getComputedStyle(segment)
          const room =
            segment.getBoundingClientRect().width -
            parseFloat(style.paddingLeft) -
            parseFloat(style.paddingRight)
          return copy.getBoundingClientRect().width <= room
        }),
      )
    }
    measure()
    // The copies resize with the text size and the font, the selector with the window.
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    for (const copy of copies) observer.observe(copy)
    return () => observer.disconnect()
  }, [selector, modes])
  return fits
}
