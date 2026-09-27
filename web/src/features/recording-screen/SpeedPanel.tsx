import { Minus, Plus } from 'lucide-react'
import { useId } from 'react'
import { RECORDING_RANGES } from '../../api/vocabulary'
import { SPEED_BADGE, SPEED_LABEL } from '../player/Dock'
import { PANEL_ICON_BUTTON, PANEL_TEXT_BUTTON, RESET } from './panel'

export const SPEED = SPEED_LABEL
export const SLOWER = 'Slower'
export const FASTER = 'Faster'

const STEP = 5
const PRESETS = [50, 75, 100] as const
const DEFAULT_SPEED = 100

function clampSpeed(percent: number): number {
  const { min, max } = RECORDING_RANGES.speed_percent
  return Math.min(max, Math.max(min, percent))
}

/** Playback speed with pitch held, applied live by whoever passes `onChange`. */
export function SpeedPanel({
  value,
  onChange,
}: {
  value: number
  onChange: (percent: number) => void
}) {
  const id = useId()
  const { min, max } = RECORDING_RANGES.speed_percent
  // A stored speed off the 5% grid steps onto it rather than keeping its odd offset.
  const step = (by: number) => onChange(clampSpeed(Math.round(value / STEP) * STEP + by))
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="type-subheadline">
          {SPEED}
        </label>
        <span className="type-subheadline tabular-nums">{SPEED_BADGE(value)}</span>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={SLOWER}
          className={PANEL_ICON_BUTTON}
          disabled={value <= min}
          onClick={() => step(-STEP)}
        >
          <Minus aria-hidden="true" className="size-5" />
        </button>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={STEP}
          value={value}
          aria-valuetext={SPEED_BADGE(value)}
          className="h-11 min-w-0 flex-1 accent-(--ion-color-primary)"
          onChange={(event) => onChange(clampSpeed(Number(event.target.value)))}
        />
        <button
          type="button"
          aria-label={FASTER}
          className={PANEL_ICON_BUTTON}
          disabled={value >= max}
          onClick={() => step(STEP)}
        >
          <Plus aria-hidden="true" className="size-5" />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((preset) => {
          const chosen = value === preset
          return (
            <button
              key={preset}
              type="button"
              aria-pressed={chosen}
              className={
                chosen
                  ? 'type-body min-h-11 rounded-full bg-(--ion-color-primary) px-4 text-(--ion-color-primary-contrast) tabular-nums'
                  : 'type-body min-h-11 rounded-full bg-(--fill-tertiary) px-4 tabular-nums'
              }
              onClick={() => onChange(preset)}
            >
              {SPEED_BADGE(preset)}
            </button>
          )
        })}
        <button
          type="button"
          className={`${PANEL_TEXT_BUTTON} ms-auto`}
          disabled={value === DEFAULT_SPEED}
          onClick={() => onChange(DEFAULT_SPEED)}
        >
          {RESET}
        </button>
      </div>
    </div>
  )
}
