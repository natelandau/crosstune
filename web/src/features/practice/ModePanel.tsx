import { Gauge, Music2, Repeat, SlidersHorizontal, type LucideIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { ModeControls, type IsolateControls } from './ModeControls'
import { Tabs } from '../../ui/Tabs'
import { ToolPopover } from '../../ui/ToolPopover'
import { ISOLATE_EFFECT_NAMES, MODE_NAMES, useModeLabels } from './useModeLabels'
import { MODES_LABEL } from './practiceCopy'
import {
  DEFAULT_ISOLATE,
  effectiveIsolate,
  isDefaultIsolate,
  type IsolateSetting,
} from '../player/isolate/isolateSetting'
import { PITCH_BADGE, SPEED_BADGE } from '../player/transportCopy'
import { availableModes, type Mode } from './usePracticeMode'
import { isAppleTouch } from '../../platform/appleTouch'

const MODE_ICONS: Record<Mode, LucideIcon> = {
  speed: Gauge,
  pitch: Music2,
  isolate: SlidersHorizontal,
  loops: Repeat,
}

interface ModePanelProps {
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
  /** How many loops the recording holds, which the toolbar shows as the Loops value. */
  loopCount?: number
  /**
   * `tabs` sets the modes as tabs over the chosen mode's controls; `toolbar` sets them as a row
   * of buttons that each show the mode's value and open its controls in a popover, for a
   * layout wide enough to hold the page's details beside practice.
   */
  layout?: 'tabs' | 'toolbar'
  /** Practice cannot be used now, which closes an open popover. */
  disabled?: boolean
}

/**
 * Speed, Pitch, Isolate, and Loops, as tabs or as a toolbar. In tabs, every mode's controls stay
 * laid out, so the panel holds the height of the tallest.
 */
export function ModePanel({ layout = 'tabs', disabled, ...props }: ModePanelProps) {
  return layout === 'toolbar' ? (
    <ModeToolbar {...props} disabled={disabled} />
  ) : (
    <ModeTabs {...props} />
  )
}

function ModeTabs({
  mode,
  onMode,
  speedPercent,
  pitchCents,
  isolate,
  ...controls
}: ModePanelProps) {
  const labels = useModeLabels(speedPercent, pitchCents, shownIsolate(isolate))
  const modes = availableModes(isolate !== null)
  // A mode this item does not offer, such as one kept from a recording, opens on Speed.
  const shown = modes.includes(mode) ? mode : 'speed'
  return (
    <div data-mode-panel-root>
      <Tabs
        data-mode-selector
        label={MODES_LABEL}
        tabs={modes.map((m) => ({
          id: m,
          label: MODE_NAMES[m],
          fullLabel: labels[m],
          icon: MODE_ICONS[m],
        }))}
        selected={shown}
        onChange={onMode}
      >
        {(id) => (
          <Controls
            {...controls}
            mode={id}
            speedPercent={speedPercent}
            pitchCents={pitchCents}
            isolate={isolate}
          />
        )}
      </Tabs>
    </div>
  )
}

function ModeToolbar({
  onMode,
  speedPercent,
  pitchCents,
  isolate,
  loopCount = 0,
  disabled = false,
  ...controls
}: ModePanelProps) {
  const [open, setOpen] = useState<Mode | null>(null)
  const setting = shownIsolate(isolate)
  const isolateChanged = !isDefaultIsolate(setting)
  const values: Record<Mode, { value: string | null; changed: boolean }> = {
    speed: { value: SPEED_BADGE(speedPercent), changed: speedPercent !== 100 },
    pitch: {
      value: pitchCents === 0 ? '0' : PITCH_BADGE(pitchCents),
      changed: pitchCents !== 0,
    },
    isolate: {
      value: isolateChanged ? ISOLATE_EFFECT_NAMES[setting.effect] : null,
      changed: isolateChanged,
    },
    loops: { value: String(loopCount), changed: loopCount > 0 },
  }
  return (
    <div
      data-mode-toolbar
      role="group"
      aria-label={MODES_LABEL}
      className="flex flex-wrap justify-center gap-2"
    >
      {availableModes(isolate !== null).map((m) => (
        <ToolPopover
          key={m}
          data-mode-tool={m}
          icon={MODE_ICONS[m]}
          label={MODE_NAMES[m]}
          value={values[m].value}
          changed={values[m].changed}
          isOpen={open === m && !disabled}
          onOpenChange={(isOpen) => {
            setOpen(isOpen ? m : null)
            // Inside the press, so iOS grants the audio context the Isolate panel's outline needs.
            if (isOpen) onMode(m)
          }}
        >
          <Controls
            {...controls}
            only
            mode={m}
            speedPercent={speedPercent}
            pitchCents={pitchCents}
            isolate={isolate}
          />
        </ToolPopover>
      ))}
    </div>
  )
}

function Controls({
  only,
  mode,
  speedPercent,
  pitchCents,
  onSpeed,
  onPitch,
  stageUnavailable,
  isolate,
  loops,
}: Omit<ModePanelProps, 'onMode' | 'layout' | 'loopCount' | 'disabled'> & { only?: boolean }) {
  return (
    <ModeControls
      only={only}
      mode={mode}
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
  )
}

/** The isolate setting the modes show, the default where nothing can isolate. */
function shownIsolate(isolate: IsolateControls | null): IsolateSetting {
  return isolate ? effectiveIsolate(isolate.value, isolate.isMono) : DEFAULT_ISOLATE
}
