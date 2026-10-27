import { Check } from 'lucide-react'
import {
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type CSSProperties,
  type RefObject,
} from 'react'
import { useReducedMotionConfig } from 'motion/react'
import { DURATION, springEasing } from '../theme/motion'
import { mergeProps, useFocusable } from 'react-aria'
import { STATUS_LABELS } from '../constants'
import { useStampedDensity } from '../platform/density'
import { Tip, TipTrigger } from './Tip'

type Known = keyof typeof STATUS_LABELS

const SHAPE =
  'box-border inline-flex size-(--glyph) shrink-0 items-center justify-center rounded-full border-2'

// The half fill is a hard-stop gradient so the shape is one painted element, not an icon.
// Forced colors drop a gradient, which would leave Learning a bare ring like Unknown, so there
// it paints itself in the system's text color.
const SHAPES: Record<Known, string> = {
  known: 'border-status-known bg-status-known text-on-status',
  learning:
    'border-status-learning bg-[linear-gradient(90deg,var(--status-learning)_50%,transparent_50%)] forced-colors:border-[CanvasText] forced-colors:bg-[linear-gradient(90deg,CanvasText_50%,transparent_50%)] forced-colors:[forced-color-adjust:none]',
  want_to_learn: 'border-status-unknown',
}

function isKnown(status: string): status is Known {
  return Object.hasOwn(STATUS_LABELS, status)
}

/**
 * A tune's learning status as a shape, color-coded and always named. An unrecognized status
 * reads as Unknown so a status the client has not learned yet never renders blank.
 */
export function StatusGlyph({ status, labelled = false }: { status: string; labelled?: boolean }) {
  const density = useStampedDensity()
  const key: Known = isKnown(status) ? status : 'want_to_learn'
  const label = STATUS_LABELS[key]
  const style = { '--glyph': density === 'touch' ? '18px' : '14px' } as CSSProperties
  const ref = useRef<HTMLSpanElement>(null)
  const shown = useRef(key)
  const reduceMotion = useReducedMotionConfig()
  // A new status pops in on the spring, so a change made elsewhere, such as from the tune's
  // status control, shows here too. The status a glyph first shows never moves. Before paint,
  // so no frame shows the new status at full size.
  useLayoutEffect(() => {
    if (shown.current === key) return
    shown.current = key
    if (reduceMotion) return
    ref.current?.animate(
      { transform: ['scale(0.6)', 'scale(1)'] },
      { duration: DURATION.long * 1000, easing: springEasing() },
    )
  }, [key, reduceMotion])
  const tip = !labelled && density !== 'touch'
  const shape = (
    <Shape
      ref={ref}
      tip={tip}
      // Focusable for its tooltip, but never a tab stop: a label is not a control.
      tabIndex={tip ? -1 : undefined}
      {...(labelled ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
      className={`${SHAPE} ${SHAPES[key]} transition-colors duration-(--dur-base) ease-(--ease)`}
      style={style}
    >
      {key === 'known' && <Check className="size-[70%]" strokeWidth={3.5} aria-hidden />}
    </Shape>
  )
  if (labelled) {
    return (
      <span className="inline-flex items-center gap-2">
        {shape}
        <span className="t-secondary">{label}</span>
      </span>
    )
  }
  if (!tip) return shape
  return (
    <TipTrigger>
      {shape}
      <Tip>{label}</Tip>
    </TipTrigger>
  )
}

/**
 * The glyph's span. With `tip` it takes its tooltip's trigger wiring, as `Focusable` would give
 * it; `Focusable` warns whenever its child mounts in an inert subtree, which every row in a list
 * behind a pushed page does.
 */
function Shape({
  ref,
  tip,
  ...props
}: ComponentProps<'span'> & { ref: RefObject<HTMLSpanElement | null>; tip: boolean }) {
  const { focusableProps } = useFocusable({ isDisabled: !tip }, ref)
  return <span ref={ref} {...mergeProps(focusableProps, props)} />
}
