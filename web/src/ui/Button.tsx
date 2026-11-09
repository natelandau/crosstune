import type { LucideIcon } from 'lucide-react'
import { useContext, useId, type ReactNode, type Ref } from 'react'
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components'
import { ControlDescription, descriptionProps } from './ControlDescription'
import { shake } from './feedback'
import { iconMotion } from './iconMotion'
import { SIZE_CLASS, useControlSize, type ControlSize } from './inRow'
import { PRESS } from './press'
import { BUTTON_CORNER, BUTTON_TONE, UNFILLED_OFF } from './buttonTone'
import { InBar } from './inBar'
import { TAP_AREA } from './tapArea'
import type { TrackWork } from './useWorking'
import { isAriaDisabled, useWorkingControl } from './useWorkingControl'
import { WorkingMark, WorkingStatus } from './WorkingMark'

export type ButtonVariant =
  'primary' | 'secondary' | 'text' | 'destructive' | 'destructiveFill' | 'warningFill'

export interface ButtonProps extends Omit<
  AriaButtonProps,
  'children' | 'className' | 'aria-label' | 'onPress'
> {
  variant?: ButtonVariant
  size?: ControlSize
  icon?: LucideIcon
  /** The accessible name. */
  label: string
  /** The accessible name when it differs from the visible label, such as one naming its row. */
  name?: string
  /** Read after the name and shown under the label in the tooltip, such as why it is off. */
  description?: string
  /**
   * Returned work shows a spinner while it runs past a moment, then a check, or a shake if it
   * fails. Work that starts after the person answers, such as a confirmation, goes to `track`
   * instead, so the spinner never shows while they decide.
   */
  onPress?: (track: TrackWork) => void | Promise<unknown>
  /** The work `onPress` returned failed. The screen's own error line says why. */
  onFailed?: (error: unknown) => void
  /** False for a button that leaves the screen when its work ends, where leaving confirms it. */
  showDone?: boolean
  /** The press cannot go ahead, such as a form with errors: it shakes and does nothing. */
  isBlocked?: boolean
  /** Fills the glyph, for a transport glyph such as Play that reads as a solid shape. */
  solidIcon?: boolean
  /** A drawn glyph in place of `icon`, such as play and pause that morph into each other. */
  glyph?: ReactNode
  fullWidth?: boolean
  ref?: Ref<HTMLButtonElement>
}

const FILLED: Record<ButtonVariant, boolean> = {
  primary: true,
  secondary: true,
  text: false,
  destructive: false,
  destructiveFill: true,
  warningFill: true,
}

const SIZE: Record<ControlSize, { type: string; inset: string }> = {
  compact: { type: 't-secondary', inset: 'px-2.5' },
  regular: { type: 't-body', inset: 'px-3' },
  large: { type: 't-body', inset: 'px-5' },
}

const SOLID_ICON = { fill: 'currentColor', strokeWidth: 0 } as const

/** A labeled control. `aria-disabled` dims it and ignores presses while leaving it able to hold focus. */
export function Button({
  variant = 'text',
  size,
  icon: Icon,
  label,
  name,
  description,
  onPress,
  onFailed,
  showDone = true,
  isBlocked,
  solidIcon,
  glyph,
  fullWidth,
  ref,
  ...rest
}: ButtonProps) {
  const inBar = useContext(InBar)
  const controlSize = useControlSize(size)
  const descriptionId = useId()
  const off = isAriaDisabled(rest['aria-disabled'])
  const { element, state, press, content } = useWorkingControl(onPress, {
    showDone,
    onFailed,
    ref,
  })
  const tone = BUTTON_TONE[variant]
  const { type, inset } = SIZE[controlSize]
  const height = SIZE_CLASS[controlSize].minH
  return (
    <>
      <AriaButton
        {...descriptionProps(descriptionId, description)}
        {...rest}
        ref={element}
        aria-label={name}
        aria-disabled={off || undefined}
        onPress={() => {
          if (off) return
          if (isBlocked) {
            if (element.current) shake(element.current)
            return
          }
          press()
        }}
        // A filled button rises under the pointer; controls.css holds the lift.
        data-lift={FILLED[variant] || undefined}
        className={`${type} inline-flex shrink-0 items-center justify-center gap-2 select-none ${TAP_AREA} ${PRESS} ${
          // A button in a bar stays round.
          inBar ? 'rounded-(--radius-capsule)' : BUTTON_CORNER
        } ${FILLED[variant] ? '' : `font-medium ${UNFILLED_OFF}`} ${height} ${inset} ${fullWidth ? 'w-full' : ''} ${tone}`}
      >
        {glyph}
        {Icon && (
          <Icon
            className={`${solidIcon ? 'size-4' : 'size-5'} shrink-0 ${content}`}
            {...(solidIcon ? SOLID_ICON : {})}
            data-motion={iconMotion(Icon)}
            aria-hidden
          />
        )}
        <span className={content}>{label}</span>
        <WorkingMark state={state} />
        <ControlDescription id={descriptionId} text={description} />
      </AriaButton>
      <WorkingStatus state={state} />
    </>
  )
}
