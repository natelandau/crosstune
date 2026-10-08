import type { LucideIcon } from 'lucide-react'
import type { Ref } from 'react'
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components'

/**
 * An icon-only control on jet, drawn in the panel's ink. Practice holds an overlay claim, which
 * keeps every tooltip shut, so the name lives on the control alone. `aria-disabled` dims it and
 * ignores presses while leaving it able to hold focus.
 */
export function PracticeButton({
  icon: Icon,
  label,
  size = 'control',
  iconClassName = 'size-6',
  ref,
  onPress,
  ...rest
}: Omit<AriaButtonProps, 'children' | 'className' | 'aria-label' | 'aria-disabled'> & {
  icon: LucideIcon
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
      className={`inline-flex shrink-0 items-center justify-center rounded-(--radius-capsule) transition-opacity duration-(--dur-short) ease-(--ease) disabled:opacity-40 aria-disabled:opacity-40 aria-pressed:bg-(--fill-tertiary) data-[pressed]:opacity-60 aria-disabled:data-[pressed]:opacity-40 ${
        size === 'large'
          ? 'size-[72px] bg-(--panel-ink) text-(--panel-on-ink)'
          : 'size-11 text-(--panel-ink)'
      }`}
    >
      <Icon aria-hidden className={iconClassName} />
    </AriaButton>
  )
}
