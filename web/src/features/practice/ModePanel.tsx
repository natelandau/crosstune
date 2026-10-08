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
            className="t-body t-num min-h-(--target) flex-1 rounded-(--radius-capsule) px-2 text-(--panel-muted) transition-colors duration-(--dur-short) ease-(--ease) data-[selected]:bg-(--panel-ink) data-[selected]:text-(--panel-on-ink)"
          >
            {labels[m]}
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
