import type { LucideIcon } from 'lucide-react'
import { useContext, type ReactNode, type Ref } from 'react'
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components'
import { useStampedDensity } from '../platform/density'
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

// A disabled filled button drops to a neutral fill rather than fading, so it reads as off, not
// faint, and keeps its shape against the ground.
const OFF =
  'disabled:bg-disabled-fill disabled:text-disabled-ink disabled:shadow-none aria-disabled:bg-disabled-fill aria-disabled:text-disabled-ink aria-disabled:shadow-none'
const VARIANT: Record<ButtonVariant, string> = {
  primary: `bg-accent-fill font-semibold text-on-accent-fill shadow-[inset_0_1px_0_rgb(255_255_255/0.16)] hover:bg-accent-fill-hover ${OFF}`,
  // A plain button's words take the accent; a glyph alone stays ink, except in a section
  // heading. The lighter hover keeps the accent at 4.5:1.
  plain: 'text-accent hover:bg-tint',
  tinted: `bg-tint font-semibold text-ink hover:bg-tint-strong ${OFF}`,
  // An outline, so a secondary action never reads like a filled button that is off.
  bordered: 'text-accent ring-1 ring-tint-strong ring-inset hover:bg-tint',
  destructive: 'text-danger hover:bg-danger/15',
  warning: 'text-warning hover:bg-warning/15',
  // The on-tone label inverts with the scheme: white on red in light, the
  // dark ground on a lighter red in dark. Hover mixes toward ink, darker in light, lighter in dark.
  destructiveFill: `bg-danger font-semibold text-on-tone hover:bg-[color-mix(in_srgb,var(--danger),var(--ink)_12%)] ${OFF}`,
  warningFill: `bg-warning font-semibold text-on-tone hover:bg-[color-mix(in_srgb,var(--warning),var(--ink)_12%)] ${OFF}`,
}

/** A plain button that is a glyph alone, such as a row's or a bar's icon control. */
const PLAIN_GLYPH = 'text-ink hover:bg-tint-hover'

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
  const tone = variant === 'plain' && iconOnly && !inHeading ? PLAIN_GLYPH : VARIANT[variant]
  const button = (
    <AriaButton
      {...rest}
      aria-label={iconOnly ? label : name}
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
    </AriaButton>
  )
  if (!iconOnly) return button
  // Disabled on touch rather than left out, so a density change keeps the button, and its
  // focus, in place.
  return (
    <TipTrigger isDisabled={density === 'touch'}>
      {button}
      <Tip>{label}</Tip>
    </TipTrigger>
  )
}
