import type { LucideIcon } from 'lucide-react'
import { useContext, useId, type ReactNode, type Ref } from 'react'
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components'
import { useStampedDensity } from '../platform/density'
import { ControlDescription, descriptionProps } from './ControlDescription'
import { iconMotion } from './iconMotion'
import { PRESS } from './press'
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

// A disabled filled button drops its fill for a ring and a faint label, so it reads as off and
// never as another filled button.
const OFF =
  'disabled:bg-transparent disabled:text-on-disabled disabled:shadow-none disabled:ring-1 disabled:ring-disabled-border disabled:ring-inset aria-disabled:bg-transparent aria-disabled:text-on-disabled aria-disabled:shadow-none aria-disabled:ring-1 aria-disabled:ring-disabled-border aria-disabled:ring-inset'
const VARIANT: Record<ButtonVariant, string> = {
  primary: `bg-accent-fill font-semibold text-on-accent-fill shadow-(--shadow-highlight) hover:bg-accent-fill-hover ${OFF}`,
  // A plain button's words take the accent; a glyph alone stays primary text, except in a section
  // heading. The lighter hover keeps the accent at 4.5:1.
  plain: 'text-accent hover:bg-tint-subtle',
  tinted: `bg-tint font-semibold text-primary hover:bg-tint-strongest ${OFF}`,
  // An outline, so a secondary action never reads like a filled button that is off.
  bordered: 'text-accent ring-1 ring-tint-strongest ring-inset hover:bg-tint-subtle',
  destructive: 'text-danger hover:bg-danger-subtle',
  warning: 'text-warning hover:bg-warning-subtle',
  // The on-status label inverts with the scheme: white on red in light, dark on a lighter red in
  // dark. Hover mixes toward primary text, darker in light, lighter in dark.
  destructiveFill: `bg-danger font-semibold text-on-status hover:bg-danger-hover ${OFF}`,
  warningFill: `bg-warning-fill font-semibold text-on-warning-fill hover:bg-warning-fill-hover ${OFF}`,
}

/** A plain button that is a glyph alone, such as a row's or a bar's icon control. */
const PLAIN_GLYPH = 'text-primary hover:bg-tint-strong'

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
  const tone = variant === 'plain' && iconOnly && !inHeading ? PLAIN_GLYPH : VARIANT[variant]
  const button = (
    <AriaButton
      {...rest}
      aria-label={iconOnly ? label : name}
      {...descriptionProps(descriptionId, description)}
      // A filled button rises under the pointer; controls.css holds the lift.
      data-lift={FILLED[variant] || undefined}
      className={`t-body inline-flex shrink-0 items-center justify-center gap-2 select-none ${PRESS} ${
        // A labeled button in content takes the control corner; an icon alone, or any button in
        // a bar, stays round.
        iconOnly || inBar ? 'rounded-(--radius-capsule)' : 'rounded-(--radius-control)'
      } ${
        FILLED[variant]
          ? ''
          : 'font-medium disabled:opacity-40 disabled:hover:bg-transparent aria-disabled:opacity-40 aria-disabled:hover:bg-transparent'
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
