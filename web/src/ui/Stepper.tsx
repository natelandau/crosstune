import { Minus, Plus } from 'lucide-react'
import { useReducedMotionConfig } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from 'react'
import { Button as AriaButton, type PressEvent } from 'react-aria-components'
import { DURATION, EASE_CSS } from '../theme/motion'
import { shake } from './feedback'
import { keyStep } from './keySteps'
import { SIZE_CLASS, useControlSize, type ControlSize } from './inRow'
import { TAP_AREA } from './tapArea'
import { useLatest } from './useLatest'

export interface StepperProps {
  /** The group's accessible name, also the reading's. */
  label: string
  value: number
  min: number
  max: number
  step?: number
  format: (value: number) => string
  decrementLabel: string
  incrementLabel: string
  onChange: (next: number) => void
  size?: ControlSize
  /** False when an enclosing group already carries the name, so it is announced once. */
  nameGroup?: boolean
}

const FIRST_REPEAT_MS = 450
const REPEAT_MS = 110
const FAST_REPEAT_MS = 50
const REPEATS_BEFORE_FAST = 5
// Off-grid by less than this many steps counts as on the grid, so float error in a fractional
// step never lands a press back on the value it started from.
const GRID_EPSILON = 1e-9

// The reading is as wide as the widest of its two ends, so a change of value never moves its
// neighbors. The ends are drawn by invisible pseudo-elements, which keeps them out of the text.
const WIDTH_SIZERS =
  'before:invisible before:col-start-1 before:row-start-1 before:h-0 before:overflow-hidden before:content-[attr(data-min)] after:invisible after:col-start-1 after:row-start-1 after:h-0 after:overflow-hidden after:content-[attr(data-max)]'

const BUTTON =
  'group/step grid shrink-0 place-items-center text-primary cursor-default transition-colors duration-(--dur-short) ease-(--ease) not-aria-disabled:hover:bg-field-hover not-aria-disabled:data-[pressed]:bg-tint-strong aria-disabled:text-on-disabled'

const ICON =
  'size-5 transition-[scale] duration-(--dur-short) ease-(--ease) group-data-[pressed]/step:not-group-aria-disabled/step:scale-[0.85] motion-reduce:group-data-[pressed]/step:scale-100'

/**
 * A value with a button on each side. A press steps it, a hold repeats and speeds up, and the
 * arrow keys step it from anywhere inside. At a limit the buttons stay focusable, dim, and
 * shake the block when pressed.
 */
export function Stepper({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  decrementLabel,
  incrementLabel,
  onChange,
  size,
  nameGroup = true,
}: StepperProps) {
  const shown = useControlSize(size)
  const group = useRef<HTMLDivElement>(null)
  const reading = useRef<HTMLSpanElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const holding = useRef(false)
  const repeated = useRef(false)
  // The last value this stepper sent and the way it moved, until the parent renders it, a single
  // step ends, or a hold is let go: a parent that declines a step leaves nothing behind.
  const sent = useRef<{ value: number; direction: 1 | -1 } | undefined>(undefined)
  const previous = useRef(value)
  const reduceMotion = useReducedMotionConfig() ?? false
  const latest = useLatest({ value, min, max, step, onChange })

  const stop = () => {
    clearTimeout(timer.current)
    timer.current = undefined
    holding.current = false
  }
  useEffect(() => stop, [])
  const clearSent = () => {
    sent.current = undefined
  }
  const release = () => {
    stop()
    clearSent()
  }

  // Returns whether the value moved to somewhere it can move on from.
  const bump = (direction: 1 | -1): boolean => {
    const { value: shown, min, max, step, onChange } = latest.current
    // A parent that renders the change later must not be sent the same step twice.
    const now = sent.current?.value ?? shown
    // The grid runs from `min` by `step`; a value off it lands on the next grid value in the
    // direction of travel.
    const steps = (now - min) / step
    const onward =
      direction > 0 ? Math.floor(steps + GRID_EPSILON) + 1 : Math.ceil(steps - GRID_EPSILON) - 1
    const next = Math.min(max, Math.max(min, min + onward * step))
    if (next === now) {
      if (group.current) shake(group.current)
      return false
    }
    sent.current = { value: next, direction }
    onChange(next)
    return next !== min && next !== max
  }

  // Repeats after the first delay, faster after a few repeats, until a limit or `stop`.
  const repeatAfterDelay = (direction: 1 | -1) => {
    let repeats = 0
    const repeat = () => {
      repeated.current = true
      if (!bump(direction)) return stop()
      repeats += 1
      timer.current = setTimeout(repeat, repeats > REPEATS_BEFORE_FAST ? FAST_REPEAT_MS : REPEAT_MS)
    }
    timer.current = setTimeout(repeat, FIRST_REPEAT_MS)
  }

  // A sync parent has rendered the step by the time the event's microtasks run, so a step still
  // unrendered then was declined.
  const stepOnce = (direction: 1 | -1) => {
    bump(direction)
    queueMicrotask(() => {
      if (!holding.current) clearSent()
    })
  }

  // A mouse or pen steps as it goes down so a hold can repeat. A touch may yet turn into a
  // scroll that cancels it, so it steps on release unless held long enough to repeat. A key
  // press or a click with no pointer has no down edge worth stepping on.
  const pressStart = (direction: 1 | -1, event: PressEvent) => {
    if (event.pointerType === 'keyboard' || event.pointerType === 'virtual') return
    stop()
    holding.current = true
    repeated.current = false
    if (event.pointerType === 'touch') repeatAfterDelay(direction)
    else if (bump(direction)) repeatAfterDelay(direction)
  }
  const press = (direction: 1 | -1, event: PressEvent) => {
    if (event.pointerType === 'keyboard' || event.pointerType === 'virtual') stepOnce(direction)
    else if (event.pointerType === 'touch' && !repeated.current) stepOnce(direction)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.altKey || event.ctrlKey) return
    const by = keyStep(event, 1, 1)
    if (by === null) return
    event.preventDefault()
    stepOnce(by > 0 ? 1 : -1)
  }

  // A value this stepper sent slides in from the side it came from, and only fades under
  // reduced motion. A value set from outside, such as a slider's drag, changes in place.
  useLayoutEffect(() => {
    const before = previous.current
    previous.current = value
    if (before === value) return
    const from = sent.current
    const ours = from !== undefined && (value === from.value || holding.current)
    if (!holding.current) clearSent()
    if (!ours || !reading.current) return
    reading.current.animate(
      [
        { transform: reduceMotion ? 'none' : `translateY(${from.direction * 70}%)`, opacity: 0 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: DURATION.short * 1000, easing: EASE_CSS },
    )
  }, [value, reduceMotion])

  const button = `${BUTTON} ${SIZE_CLASS[shown].w} ${TAP_AREA}`
  return (
    <div
      ref={group}
      role="group"
      aria-label={nameGroup ? label : undefined}
      onKeyDown={onKeyDown}
      data-focus-host
      className={`bg-field inline-flex shrink-0 items-stretch rounded-(--radius) ${SIZE_CLASS[shown].h}`}
    >
      <AriaButton
        aria-label={decrementLabel}
        aria-disabled={value <= min || undefined}
        onPressStart={(event) => pressStart(-1, event)}
        onPress={(event) => press(-1, event)}
        onPressUp={stop}
        onPressEnd={release}
        className={`${button} rounded-l-(--radius)`}
      >
        <Minus className={ICON} aria-hidden />
      </AriaButton>
      <output
        aria-label={label}
        data-min={format(min)}
        data-max={format(max)}
        className={`t-body border-border grid place-items-center overflow-hidden border-x font-semibold tabular-nums ${SIZE_CLASS[shown].minW2} ${WIDTH_SIZERS}`}
      >
        <span ref={reading} className="col-start-1 row-start-1 block">
          {format(value)}
        </span>
      </output>
      <AriaButton
        aria-label={incrementLabel}
        aria-disabled={value >= max || undefined}
        onPressStart={(event) => pressStart(1, event)}
        onPress={(event) => press(1, event)}
        onPressUp={stop}
        onPressEnd={release}
        className={`${button} rounded-r-(--radius)`}
      >
        <Plus className={ICON} aria-hidden />
      </AriaButton>
    </div>
  )
}
