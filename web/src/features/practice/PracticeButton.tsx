import type { LucideIcon } from 'lucide-react'
import type { ReactNode, Ref } from 'react'
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components'
import { iconMotion } from '../../ui/iconMotion'
import { PRESS } from '../../ui/press'
import { PANEL_HOVER } from './panel'

/**
 * An icon-only control on practice's background, drawn in on-practice white. Practice holds an overlay claim, which
 * keeps every tooltip shut, so the name lives on the control alone. `aria-disabled` dims it and
 * ignores presses while leaving it able to hold focus.
 */
export function PracticeButton({
  icon: Icon,
  glyph,
  label,
  size = 'control',
  iconClassName = 'size-6',
  ref,
  onPress,
  ...rest
}: Omit<AriaButtonProps, 'children' | 'className' | 'aria-label' | 'aria-disabled'> & {
  icon?: LucideIcon
  /** A drawn glyph in place of `icon`, such as play and pause that morph into each other. */
  glyph?: ReactNode
  label: string
  size?: 'control' | 'large'
  iconClassName?: string
  ref?: Ref<HTMLButtonElement>
  'aria-disabled'?: boolean
}) {
  return (
    <AriaButton
      {...rest}
      ref={ref}
      aria-label={label}
      aria-disabled={rest['aria-disabled'] || undefined}
      onPress={rest['aria-disabled'] ? undefined : onPress}
      // The large control is practice's filled button, which rises under the pointer.
      data-lift={size === 'large' || undefined}
      className={`aria-pressed:bg-practice-fill inline-flex shrink-0 items-center justify-center rounded-(--radius-capsule) disabled:opacity-40 aria-disabled:opacity-40 ${PRESS} ${
        size === 'large'
          ? 'bg-on-practice text-practice-background not-disabled:not-aria-disabled:hover:bg-on-practice-hover size-[72px]'
          : `text-on-practice size-11 ${PANEL_HOVER}`
      }`}
    >
      {glyph ??
        (Icon && <Icon aria-hidden className={iconClassName} data-motion={iconMotion(Icon)} />)}
    </AriaButton>
  )
}
