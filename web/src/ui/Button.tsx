import type { LucideIcon } from 'lucide-react'
import type { Ref } from 'react'
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components'
import { useStampedDensity } from '../platform/density'
import { Tip, TipTrigger } from './Tip'

export type ButtonVariant = 'primary' | 'plain' | 'quiet' | 'destructive' | 'warning'

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
  fullWidth?: boolean
  ref?: Ref<HTMLButtonElement>
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-slate font-bold text-on-slate',
  plain: 'text-slate',
  quiet: 'bg-fill text-ink',
  destructive: 'text-danger',
  warning: 'text-warning',
}

export function Button({
  variant = 'plain',
  icon: Icon,
  label,
  name,
  iconOnly,
  fullWidth,
  ...rest
}: ButtonProps) {
  const density = useStampedDensity()
  const button = (
    <AriaButton
      {...rest}
      aria-label={iconOnly ? label : name}
      className={`t-body inline-flex min-h-(--target-control) shrink-0 items-center justify-center gap-2 rounded-(--radius-capsule) transition-opacity duration-(--dur-short) ease-(--ease) disabled:opacity-40 aria-disabled:opacity-40 data-[pressed]:opacity-60 aria-disabled:data-[pressed]:opacity-40 ${
        iconOnly ? 'min-w-(--target-control)' : 'px-4'
      } ${fullWidth ? 'w-full' : ''} ${VARIANT[variant]}`}
    >
      {Icon && <Icon className="size-5 shrink-0" aria-hidden />}
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
