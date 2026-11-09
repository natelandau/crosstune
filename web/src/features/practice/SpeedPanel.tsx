import { RECORDING_RANGES } from '../../api/vocabulary'
import { SPEED_BADGE, SPEED_LABEL } from '../player/transportCopy'
import { SegmentedChoice } from '../../ui/SegmentedChoice'
import { Slider } from '../../ui/Slider'
import { SPEED_STEP } from './panel'
import { ResetButton } from './ResetButton'

export const SPEED = SPEED_LABEL
export const SLOWER = 'Slower'
export const FASTER = 'Faster'

const PRESET_SEGMENTS = [50, 75, 100].map((preset) => ({
  id: String(preset),
  label: SPEED_BADGE(preset),
}))
const DEFAULT_SPEED = 100
const SPEED_LARGE_STEP = 25

/** Playback speed with pitch held, applied live by whoever passes `onChange`. */
export function SpeedPanel({
  value,
  onChange,
}: {
  value: number
  onChange: (percent: number) => void
}) {
  const { min, max } = RECORDING_RANGES.speed_percent
  return (
    <div className="flex flex-col gap-3">
      <Slider
        label={SPEED}
        value={value}
        min={min}
        max={max}
        step={SPEED_STEP}
        largeStep={SPEED_LARGE_STEP}
        detent={DEFAULT_SPEED}
        format={SPEED_BADGE}
        decrementLabel={SLOWER}
        incrementLabel={FASTER}
        onChange={onChange}
      />
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedChoice
          label={SPEED}
          segments={PRESET_SEGMENTS}
          selected={PRESET_SEGMENTS.find((preset) => preset.id === String(value))?.id ?? null}
          onChange={(preset) => onChange(Number(preset))}
        />
        <div className="ms-auto flex">
          <ResetButton
            atDefault={value === DEFAULT_SPEED}
            onReset={() => onChange(DEFAULT_SPEED)}
          />
        </div>
      </div>
    </div>
  )
}
