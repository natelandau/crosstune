import { X } from 'lucide-react'
import type { ReactNode, Ref } from 'react'
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components'
import { PRESS } from './press'

export interface CapsuleProps extends Omit<
  AriaButtonProps,
  'children' | 'className' | 'aria-label'
> {
  /** The accessible name, and the visible text unless `children` gives the face. */
  label: string
  /** A face other than the label, such as a glyph and a count; `label` stays the name. */
  children?: ReactNode
  ref?: Ref<HTMLButtonElement>
  /** The filter holds a value. Marks the element with `data-set` so a `FilterRow` can find it. */
  set?: boolean
  /** Renders a token with a trailing remove control. */
  onRemove?: () => void
  removeLabel?: string
}

// The visual capsule can be shorter than the target; ::after extends the hit area to it.
export const CAPSULE_HIT =
  "relative after:absolute after:inset-x-0 after:top-1/2 after:h-(--target-filter) after:-translate-y-1/2 after:content-['']"
const SHAPE =
  't-secondary inline-flex h-[min(2rem,var(--target-filter))] items-center rounded-(--radius-capsule) px-3'

function tone(set: boolean | undefined): string {
  return set
    ? 'bg-set-fill font-medium text-set-label hover:bg-tint-strong'
    : 'bg-fill text-ink hover:bg-fill-hover'
}

export function Capsule({ label, children, set, onRemove, removeLabel, ...rest }: CapsuleProps) {
  if (!onRemove) {
    return (
      <AriaButton
        {...rest}
        aria-label={children === undefined ? undefined : label}
        data-set={set ? label : undefined}
        className={`${SHAPE} ${CAPSULE_HIT} ${PRESS} ${tone(set)} gap-1.5 disabled:opacity-40`}
      >
        {children ?? label}
      </AriaButton>
    )
  }
  return (
    <span
      className={`${SHAPE} ${tone(set)} ps-3 pe-0`}
      role="group"
      aria-label={label}
      data-set={set ? label : undefined}
    >
      <AriaButton {...rest} className={`${CAPSULE_HIT} ${PRESS} h-full`}>
        {label}
      </AriaButton>
      <AriaButton
        aria-label={removeLabel}
        onPress={onRemove}
        className={`${CAPSULE_HIT} ${PRESS} inline-flex h-full w-(--target-filter) items-center justify-center rounded-(--radius-capsule)`}
      >
        <X className="size-3.5" aria-hidden />
      </AriaButton>
    </span>
  )
}
