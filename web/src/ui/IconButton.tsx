import type { LucideIcon } from 'lucide-react'
import {
  useContext,
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type Ref,
  type SVGProps,
} from 'react'
import {
  Button as AriaButton,
  ToggleButton,
  type ButtonProps as AriaButtonProps,
  type ToggleButtonProps,
} from 'react-aria-components'
import { useStampedDensity } from '../platform/density'
import { ControlDescription, descriptionProps } from './ControlDescription'
import { BUTTON_TONE, UNFILLED_OFF } from './buttonTone'
import { pop } from './feedback'
import { iconMotion } from './iconMotion'
import { SIZE_CLASS, useControlSize, type ControlSize } from './inRow'
import { PRESS } from './press'
import { InSectionHeading } from './sectionHeading'
import { TAP_AREA } from './tapArea'
import { Tip, TipTrigger } from './Tip'
import type { TrackWork } from './useWorking'
import { isAriaDisabled, useWorkingControl } from './useWorkingControl'
import { WorkingMark, WorkingStatus } from './WorkingMark'

export type IconButtonVariant = 'plain' | 'neutral' | 'toggle' | 'feature' | 'destructive'
export type IconButtonSize = ControlSize | 'large44' | 'transport' | 'feature'

export interface IconButtonProps extends Omit<
  AriaButtonProps,
  'children' | 'className' | 'aria-label' | 'onPress' | 'render'
> {
  icon?: LucideIcon
  /** A drawn glyph in place of `icon`, such as play and pause that morph into each other. */
  glyph?: ReactNode
  /** The accessible name, and the pointer tooltip. */
  label: string
  /** Read after the name and shown under the label in the tooltip, such as why it is off. */
  description?: string
  variant?: IconButtonVariant
  size?: IconButtonSize
  /** Whether a `toggle` is on. A toggle is always controlled, so one that is off never flips. */
  isSelected?: boolean
  onChange?: (isSelected: boolean) => void
  /** Returned work shows a spinner past a moment, then a check, as on `Button`. */
  onPress?: (track: TrackWork) => void | Promise<unknown>
  onFailed?: (error: unknown) => void
  showDone?: boolean
  ref?: Ref<HTMLButtonElement>
}

// Sizes off the control scale. `transport` flanks a `feature` play button, at the proportions
// music players use, so skip and seek read as part of the transport rather than as extras.
const FIXED: Record<'large44' | 'transport' | 'feature', { box: string; icon: string }> = {
  large44: { box: 'size-11', icon: 'size-6' },
  transport: { box: 'size-16', icon: 'size-9' },
  feature: { box: 'size-18', icon: 'size-7' },
}

const TONE: Record<Exclude<IconButtonVariant, 'plain'>, string> = {
  neutral:
    'bg-field text-primary not-disabled:not-aria-disabled:hover:bg-field-hover off:opacity-40',
  toggle: `text-primary hover:bg-tint-strong data-[selected]:bg-tint data-[selected]:text-accent data-[selected]:hover:bg-tint-strongest ${UNFILLED_OFF}`,
  feature: BUTTON_TONE.primary,
  destructive: `${BUTTON_TONE.destructive} ${UNFILLED_OFF}`,
}

const PLAIN = `text-primary hover:bg-tint-strong ${UNFILLED_OFF}`
// A bare glyph takes the accent in a section heading, as a heading's text button does, and in
// the transport, where skip and seek match the play button they flank.
const PLAIN_ACCENT = `${BUTTON_TONE.text} ${UNFILLED_OFF}`

/**
 * A round icon-only control for toolbars, toggles, and the transport. `aria-disabled` dims it and
 * ignores presses while leaving it able to hold focus.
 */
export function IconButton({
  icon: Icon,
  glyph,
  label,
  description,
  variant = 'plain',
  size,
  isSelected,
  onChange,
  onPress,
  onFailed,
  showDone = true,
  ref,
  ...rest
}: IconButtonProps) {
  const density = useStampedDensity()
  const inHeading = useContext(InSectionHeading)
  const isFixed = size === 'large44' || size === 'transport' || size === 'feature'
  const fixed = isFixed ? FIXED[size] : undefined
  const controlSize = useControlSize(isFixed ? 'regular' : size)
  const box = fixed?.box ?? SIZE_CLASS[controlSize].square
  const iconSize = fixed?.icon ?? 'size-5'
  const descriptionId = useId()
  const icon = useRef<SVGSVGElement | null>(null)
  const wasSelected = useRef(isSelected)
  const off = isAriaDisabled(rest['aria-disabled'])
  const { element, state, press, content } = useWorkingControl(onPress, {
    showDone,
    onFailed,
    ref,
  })

  useEffect(() => {
    if (isSelected && !wasSelected.current && icon.current) pop(icon.current)
    wasSelected.current = isSelected
  }, [isSelected])

  const tone =
    variant === 'plain' ? (inHeading || size === 'transport' ? PLAIN_ACCENT : PLAIN) : TONE[variant]
  const className = `inline-flex shrink-0 items-center justify-center rounded-[50%] select-none ${TAP_AREA} ${PRESS} ${box} ${tone}`
  const shared = {
    ...descriptionProps(descriptionId, description),
    ...rest,
    ref: element,
    'aria-label': label,
    'aria-disabled': off || undefined,
    // A feature button is the filled one, which rises under the pointer; controls.css holds it.
    'data-lift': variant === 'feature' || undefined,
    className,
  }
  const body = (
    <>
      {glyph}
      {Icon && (
        <Icon
          ref={icon as SVGProps<SVGSVGElement>['ref']}
          className={`${iconSize} shrink-0 ${content}`}
          data-motion={iconMotion(Icon)}
          aria-hidden
        />
      )}
      <WorkingMark state={state} />
      <ControlDescription id={descriptionId} text={description} />
    </>
  )
  const button =
    variant === 'toggle' ? (
      <ToggleButton
        {...(shared as unknown as ToggleButtonProps)}
        isSelected={isSelected ?? false}
        onChange={off ? undefined : onChange}
      >
        {body}
      </ToggleButton>
    ) : (
      <AriaButton {...shared} onPress={off ? undefined : press}>
        {body}
      </AriaButton>
    )
  // Disabled on touch rather than left out, so a density change keeps the button, and its
  // focus, in place.
  return (
    <>
      <TipTrigger isDisabled={density === 'touch'}>
        {button}
        <Tip>
          {label}
          {description && <span className="block">{description}</span>}
        </Tip>
      </TipTrigger>
      <WorkingStatus state={state} />
    </>
  )
}
