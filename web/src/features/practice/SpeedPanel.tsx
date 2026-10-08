import { Minus, Plus } from 'lucide-react'
import { useId } from 'react'
import { RECORDING_RANGES } from '../../api/vocabulary'
import { SPEED_BADGE, SPEED_LABEL } from '../player/transportCopy'
import {
  clampSpeed,
  PANEL_ICON_BUTTON,
  PANEL_TEXT_BUTTON,
  RESET,
  SPEED_STEP,
  stepSpeed,
} from './panel'

export const SPEED = SPEED_LABEL
export const SLOWER = 'Slower'
export const FASTER = 'Faster'

const PRESETS = [50, 75, 100] as const
const DEFAULT_SPEED = 100

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
  const step = (by: number) => onChange(stepSpeed(value, by))
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="t-secondary">
          {SPEED}
        </label>
        <span className="t-secondary tabular-nums">{SPEED_BADGE(value)}</span>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={SLOWER}
          className={PANEL_ICON_BUTTON}
          disabled={value <= min}
          onClick={() => step(-SPEED_STEP)}
        >
          <Minus aria-hidden="true" className="size-5" />
        </button>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={SPEED_STEP}
          value={value}
          aria-valuetext={SPEED_BADGE(value)}
          className="h-11 min-w-0 flex-1 accent-(--panel-ink)"
          onChange={(event) => onChange(clampSpeed(Number(event.target.value)))}
        />
        <button
          type="button"
          aria-label={FASTER}
          className={PANEL_ICON_BUTTON}
          disabled={value >= max}
          onClick={() => step(SPEED_STEP)}
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
                  ? 't-body min-h-11 rounded-full bg-(--panel-ink) px-4 text-(--panel-on-ink) tabular-nums'
                  : 't-body min-h-11 rounded-full bg-(--fill-tertiary) px-4 tabular-nums'
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
