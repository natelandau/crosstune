import type { LucideIcon } from 'lucide-react'
import { useContext, useId, type ReactNode, type Ref } from 'react'
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components'
import { useStampedDensity } from '../platform/density'
import { ControlDescription, descriptionProps } from './ControlDescription'
import { iconMotion } from './iconMotion'
import { PRESS } from './press'
import { BUTTON_CORNER, BUTTON_TONE, PLAIN_GLYPH, UNFILLED_OFF } from './buttonTone'
import { InBar } from './inBar'
import { InSectionHeading } from './sectionHeading'
import { Tip, TipTrigger } from './Tip'

export type ButtonVariant =
  | 'primary'
  | 'plain'
  | 'tinted'
  | 'bordered'
  | 'destructive'
  | 'warning'
  | 'destructiveFill'
  | 'warningFill'

export interface ButtonProps extends Omit<
  AriaButtonProps,
  'children' | 'className' | 'aria-label'
> {
  variant?: ButtonVariant
  icon?: LucideIcon
  /** The accessible name, and the pointer tooltip when `iconOnly`. */
  label: string
  /** The accessible name when it differs from the visible label, such as one naming its row. */
  name?: string
  /** Read after the name and shown under the label in the tooltip, such as why it is off. */
  description?: string
  iconOnly?: boolean
  /** Fills the glyph, for a transport glyph such as Play that reads as a solid shape. */
  solidIcon?: boolean
  /** A drawn glyph in place of `icon`, such as play and pause that morph into each other. */
  glyph?: ReactNode
  fullWidth?: boolean
  /** A taller target with a larger label, for the one action a page leads to. */
  large?: boolean
  ref?: Ref<HTMLButtonElement>
}

const FILLED: Record<ButtonVariant, boolean> = {
  primary: true,
  plain: false,
  tinted: true,
  bordered: false,
  destructive: false,
  warning: false,
  destructiveFill: true,
  warningFill: true,
}

export function Button({
  variant = 'plain',
  icon: Icon,
  label,
  name,
  description,
  iconOnly,
  solidIcon,
  glyph,
  fullWidth,
  large,
  ...rest
}: ButtonProps) {
  const density = useStampedDensity()
  const inHeading = useContext(InSectionHeading)
  const inBar = useContext(InBar)
  const descriptionId = useId()
  const tone = variant === 'plain' && iconOnly && !inHeading ? PLAIN_GLYPH : BUTTON_TONE[variant]
  const button = (
    <AriaButton
      {...rest}
      aria-label={iconOnly ? label : name}
      {...descriptionProps(descriptionId, description)}
      // A filled button rises under the pointer; controls.css holds the lift.
      data-lift={FILLED[variant] || undefined}
      className={`t-body inline-flex shrink-0 items-center justify-center gap-2 select-none ${PRESS} ${
        // A filled or labeled button in content takes the control corner; a bare glyph, or any
        // button in a bar, stays round.
        (iconOnly && !FILLED[variant]) || inBar ? 'rounded-(--radius-capsule)' : BUTTON_CORNER
      } ${
        FILLED[variant] ? '' : `font-medium ${UNFILLED_OFF}`
      } ${large ? 'min-h-14 text-lg!' : 'min-h-(--target-control)'} ${iconOnly ? 'min-w-(--target-control)' : large ? 'px-6' : 'px-4'} ${fullWidth ? 'w-full' : ''} ${tone}`}
    >
      {glyph}
      {Icon &&
        (solidIcon ? (
          <Icon
            className="size-4 shrink-0"
            fill="currentColor"
            strokeWidth={0}
            data-motion={iconMotion(Icon)}
            aria-hidden
          />
        ) : (
          <Icon className="size-5 shrink-0" data-motion={iconMotion(Icon)} aria-hidden />
        ))}
      {!iconOnly && label}
      <ControlDescription id={descriptionId} text={description} />
    </AriaButton>
  )
  if (!iconOnly) return button
  // Disabled on touch rather than left out, so a density change keeps the button, and its
  // focus, in place.
  return (
    <TipTrigger isDisabled={density === 'touch'}>
      {button}
      <Tip>
        {label}
        {description && <span className="block">{description}</span>}
      </Tip>
    </TipTrigger>
  )
}
