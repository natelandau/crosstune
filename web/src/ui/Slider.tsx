import { useRef, useState, type KeyboardEvent } from 'react'
import { Slider as AriaSlider, SliderThumb, SliderTrack } from 'react-aria-components'
import { haptic, snapPulse } from './feedback'
import { keyStep } from './keySteps'
import { Stepper } from './Stepper'
import { TAP_AREA } from './tapArea'
import { useLatest } from './useLatest'
import { useWindowPointerEnd } from './useWindowPointerEnd'

export interface SliderProps {
  /** The slider's accessible name, also the readout's. */
  label: string
  value: number
  min: number
  max: number
  step: number
  /** What Shift with an arrow, and Page Up or Down, move by. */
  largeStep?: number
  /** A default value, marked on the track, that a drag snaps to when it comes near. */
  detent?: number
  /** How near a drag snaps to the detent. Defaults to 4% of the range. */
  snapRange?: number
  format: (value: number) => string
  decrementLabel: string
  incrementLabel: string
  onChange: (next: number) => void
}

const DEFAULT_SNAP_FRACTION = 0.04
// Off-grid by less than this many steps counts as on the grid, as in the stepper.
const GRID_EPSILON = 1e-9

const THUMB =
  'top-1/2 size-(--thumb) rounded-(--radius-capsule) bg-(--accent-track) shadow-(--shadow-control) outline-none transition-[scale] duration-(--dur-short) ease-(--ease) data-[hovered]:scale-110 data-[dragging]:scale-125 data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-solid data-[focus-visible]:outline-accent motion-reduce:data-[hovered]:scale-100 motion-reduce:data-[dragging]:scale-100'

/**
 * A value dragged across a range, drawn here rather than by the browser, with a stepper above
 * it that reads the value and takes single steps. A drag that comes near the detent snaps to it,
 * pulsing the thumb once; the keyboard passes through the detent without snapping.
 */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  largeStep = step * 10,
  detent,
  snapRange = (max - min) * DEFAULT_SNAP_FRACTION,
  format,
  decrementLabel,
  incrementLabel,
  onChange,
}: SliderProps) {
  const thumb = useRef<HTMLDivElement>(null)
  // The ref answers `change` within the pointerdown that starts a drag; the state keeps the
  // window listening for its end.
  const dragging = useRef(false)
  const [dragActive, setDragActive] = useState(false)
  const [snapped, setSnapped] = useState(false)
  const latest = useLatest({ value, min, max, step, detent, snapRange, onChange })

  useWindowPointerEnd(dragActive, () => {
    dragging.current = false
    setDragActive(false)
  })

  const atDetent = detent !== undefined && value === detent
  if (snapped && !atDetent) setSnapped(false)

  const change = (raw: number) => {
    const { value: now, detent, snapRange, onChange } = latest.current
    const near = dragging.current && detent !== undefined && Math.abs(raw - detent) <= snapRange
    const next = near ? detent : raw
    if (next === now) return
    if (near && now !== detent) {
      if (thumb.current) snapPulse(thumb.current)
      setSnapped(true)
      haptic()
    }
    onChange(next)
  }

  const onKeyDownCapture = (event: KeyboardEvent) => {
    if (event.metaKey || event.altKey || event.ctrlKey) return
    const large = event.shiftKey || event.key.startsWith('Page')
    const by = large ? keyStep(event, largeStep, largeStep, true) : null
    if (by === null) return
    // React Aria steps by one on an arrow key and by a tenth of the range on a page key.
    event.preventDefault()
    event.stopPropagation()
    const { value: now, min, max, step, onChange } = latest.current
    // An off-grid value lands on the grid, short of the large step rather than past it.
    const steps = (now + by - min) / step
    const onGrid = by > 0 ? Math.floor(steps + GRID_EPSILON) : Math.ceil(steps - GRID_EPSILON)
    const next = Math.min(max, Math.max(min, min + onGrid * step))
    if (next !== now) onChange(next)
  }

  const percent = (at: number) => `${((at - min) / (max - min)) * 100}%`

  return (
    <div
      onKeyDownCapture={onKeyDownCapture}
      className="[--thumb:1rem] in-data-[density=touch]:[--thumb:1.5rem]"
    >
      <AriaSlider
        aria-label={label}
        value={value}
        minValue={min}
        maxValue={max}
        step={step}
        onChange={change}
        className="flex flex-col gap-1"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="t-secondary" aria-hidden>
            {label}
          </span>
          <Stepper
            label={label}
            value={value}
            min={min}
            max={max}
            step={step}
            format={format}
            decrementLabel={decrementLabel}
            incrementLabel={incrementLabel}
            onChange={onChange}
            nameGroup={false}
          />
        </div>
        <SliderTrack
          data-slider-track
          onPointerDownCapture={() => {
            dragging.current = true
            setDragActive(true)
          }}
          className={`mx-[calc(var(--thumb)/2)] flex h-(--size-regular) items-center ${TAP_AREA}`}
        >
          {({ state }) => {
            const fill = `${state.getThumbPercent(0) * 100}%`
            return (
              <>
                <div className="bg-field pointer-events-none absolute inset-x-[calc(var(--thumb)/-2)] top-1/2 h-1 -translate-y-1/2 rounded-(--radius-capsule)" />
                <div
                  className="pointer-events-none absolute top-1/2 left-[calc(var(--thumb)/-2)] h-1 -translate-y-1/2 rounded-(--radius-capsule) bg-(--accent-track)"
                  style={{ width: `calc(var(--thumb) / 2 + ${fill})` }}
                />
                {detent !== undefined ? (
                  <i
                    data-detent-tick
                    data-snapped={snapped}
                    className={`pointer-events-none absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-[1px] transition-colors duration-(--dur-short) ease-(--ease) ${snapped ? 'bg-accent' : 'bg-(--border-strong)'}`}
                    style={{ left: percent(detent) }}
                  />
                ) : null}
                <SliderThumb ref={thumb} data-slider-thumb className={THUMB} />
              </>
            )
          }}
        </SliderTrack>
      </AriaSlider>
    </div>
  )
}
