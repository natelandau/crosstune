import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { ToggleButton, ToggleButtonGroup } from 'react-aria-components'
import { ModeControls } from './ModeControls'
import { useModeLabels } from './useModeLabels'
import { MODES_LABEL } from './practiceCopy'
import { MODES, type Mode } from './usePracticeMode'
import { isAppleTouch } from '../../platform/appleTouch'

/**
 * Loops, Speed, and Pitch as one segmented choice over the chosen mode's controls. Every
 * mode's controls stay laid out, so the panel holds the height of the tallest.
 */
export function ModePanel({
  mode,
  onMode,
  speedPercent,
  pitchCents,
  onSpeed,
  onPitch,
  pitchUnavailable,
  loops,
}: {
  mode: Mode
  onMode: (mode: Mode) => void
  speedPercent: number
  pitchCents: number
  onSpeed: (percent: number) => void
  onPitch: (cents: number) => void
  pitchUnavailable: boolean
  /** The Loops mode's panel. */
  loops: ReactNode
}) {
  const labels = useModeLabels(speedPercent, pitchCents)
  return (
    <div data-mode-panel-root className="flex flex-col gap-3">
      <ToggleButtonGroup
        data-mode-selector
        aria-label={MODES_LABEL}
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[mode]}
        onSelectionChange={(keys) => {
          const next = MODES.find((m) => keys.has(m))
          if (next) onMode(next)
        }}
        className="flex rounded-(--radius-capsule) bg-white/10 p-0.5"
      >
        {MODES.map((m) => (
          <ToggleButton
            key={m}
            id={m}
            className="t-body t-num relative min-h-(--target) flex-1 cursor-default rounded-(--radius-capsule) px-2 text-(--panel-muted) transition-colors duration-(--dur-short) ease-(--ease) hover:text-(--panel-ink) data-[selected]:text-(--panel-on-ink) data-[selected]:delay-150"
          >
            {/* One pill shared across the modes, so choosing a mode slides it there. */}
            {m === mode && (
              <motion.span
                layoutId="practice-mode-pill"
                aria-hidden
                className="absolute inset-0 z-0 rounded-(--radius-capsule) bg-(--panel-ink)"
              />
            )}
            {/* Above the pill as it slides past, and darkening as it arrives rather than before. */}
            <span className="relative z-10">{labels[m]}</span>
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <ModeControls
        mode={mode}
        speedPercent={speedPercent}
        pitchCents={pitchCents}
        onSpeed={onSpeed}
        onPitch={onPitch}
        pitchUnavailable={pitchUnavailable}
        // Safari suspends the Web Audio graph that shifts pitch once the phone locks.
        lockNotice={isAppleTouch()}
        loops={loops}
      />
    </div>
  )
}
