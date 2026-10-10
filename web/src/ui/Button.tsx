import type { LucideIcon } from 'lucide-react'
import type { ReactNode, Ref } from 'react'
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components'
import { useStampedDensity } from '../platform/density'
import { iconMotion } from './iconMotion'
import { PRESS } from './press'
import { Tip, TipTrigger } from './Tip'

export type ButtonVariant = 'primary' | 'plain' | 'tinted' | 'destructive' | 'warning'

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
  ref?: Ref<HTMLButtonElement>
}

// A disabled filled button drops to a neutral fill rather than fading, so it reads as off, not
// faint, and keeps its shape against the ground.
const OFF =
  'disabled:bg-disabled-fill disabled:text-disabled-ink disabled:shadow-none aria-disabled:bg-disabled-fill aria-disabled:text-disabled-ink aria-disabled:shadow-none'
const VARIANT: Record<ButtonVariant, string> = {
  primary: `bg-accent font-semibold text-on-accent shadow-[inset_0_1px_0_rgb(255_255_255/0.16)] hover:bg-accent-hover ${OFF}`,
  plain: 'text-action hover:bg-tint-hover',
  tinted: `bg-tint font-semibold text-action hover:bg-tint-strong ${OFF}`,
  destructive: 'text-danger hover:bg-danger/15',
  warning: 'text-warning hover:bg-warning/15',
}

const FILLED: Record<ButtonVariant, boolean> = {
  primary: true,
  plain: false,
  tinted: true,
  destructive: false,
  warning: false,
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
  ...rest
}: ButtonProps) {
  const density = useStampedDensity()
  const button = (
    <AriaButton
      {...rest}
      aria-label={iconOnly ? label : name}
      // A filled button rises under the pointer; controls.css holds the lift.
      data-lift={FILLED[variant] || undefined}
      className={`t-body inline-flex min-h-(--target-control) shrink-0 items-center justify-center gap-2 rounded-(--radius-capsule) select-none ${PRESS} ${
        FILLED[variant]
          ? ''
          : 'font-medium disabled:opacity-40 disabled:hover:bg-transparent aria-disabled:opacity-40 aria-disabled:hover:bg-transparent'
      } ${iconOnly ? 'min-w-(--target-control)' : 'px-4'} ${fullWidth ? 'w-full' : ''} ${VARIANT[variant]}`}
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
