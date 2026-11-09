import { X } from 'lucide-react'
import type { ReactNode, Ref } from 'react'
import { useHref, useNavigate } from 'react-router'
import {
  Button as AriaButton,
  Link as AriaLink,
  RouterProvider as AriaRouterProvider,
  ToggleButton as AriaToggleButton,
  type ButtonProps as AriaButtonProps,
  type LinkProps as AriaLinkProps,
  type ToggleButtonProps,
} from 'react-aria-components'
import { PRESS } from './press'

export interface CapsuleProps extends Omit<
  AriaButtonProps,
  'children' | 'className' | 'aria-label' | 'render'
> {
  /** The accessible name, and the visible text unless `children` gives other content. */
  label: string
  /** Visible content other than the label, such as a glyph and a count; `label` stays the name. */
  children?: ReactNode
  /** The button, or the link when `to` is set. */
  ref?: Ref<HTMLElement>
  /** The filter holds a value. Marks the element with `data-set` so a `FilterRow` can find it. */
  set?: boolean
  /** Renders a token with a trailing remove control. */
  onRemove?: () => void
  removeLabel?: string
  /** Renders a link to this path, with the capsule's look. */
  to?: string
  /** Makes a toggle: a selected capsule takes the set tone in semibold. */
  isSelected?: boolean
  onChange?: (isSelected: boolean) => void
}

// The visual capsule can be shorter than the target; ::after extends the hit area to it.
export const CAPSULE_HIT =
  "relative after:absolute after:inset-x-0 after:top-1/2 after:h-(--target-filter) after:-translate-y-1/2 after:content-['']"
const SHAPE =
  't-secondary inline-flex h-(--size-compact) items-center rounded-(--radius-capsule) px-3'

const UNSET_TONE = 'bg-field text-primary hover:bg-field-hover'
const SET_TONE = 'bg-tint font-medium text-on-tint hover:bg-tint-strong'
const PRESSABLE = `${SHAPE} ${CAPSULE_HIT} ${PRESS} gap-1.5`

export function Capsule({
  label,
  children,
  set,
  onRemove,
  removeLabel,
  to,
  isSelected,
  onChange,
  ref,
  ...rest
}: CapsuleProps) {
  // A ref to any element fits the button and the link alike, since each is one.
  const buttonRef = ref as Ref<HTMLButtonElement> | undefined
  const name = children === undefined ? undefined : label
  const tone = set ? SET_TONE : UNSET_TONE
  if (to !== undefined) {
    return (
      <CapsuleLink
        {...(rest as Omit<AriaLinkProps, 'href'>)}
        ref={ref as Ref<HTMLAnchorElement> | undefined}
        href={to}
        aria-label={name}
        className={`${PRESSABLE} ${tone}`}
      >
        {children ?? label}
      </CapsuleLink>
    )
  }
  if (isSelected !== undefined || onChange) {
    return (
      <AriaToggleButton
        {...(rest as ToggleButtonProps)}
        ref={buttonRef}
        isSelected={isSelected}
        onChange={onChange}
        aria-label={name}
        className={`${PRESSABLE} ${UNSET_TONE} data-[selected]:bg-tint data-[selected]:text-on-tint data-[selected]:hover:bg-tint-strongest disabled:opacity-40 data-[selected]:font-semibold`}
      >
        {children ?? label}
      </AriaToggleButton>
    )
  }
  if (!onRemove) {
    return (
      <AriaButton
        {...rest}
        ref={buttonRef}
        aria-label={name}
        data-set={set ? label : undefined}
        className={`${PRESSABLE} ${tone} disabled:opacity-40`}
      >
        {children ?? label}
      </AriaButton>
    )
  }
  return (
    <span
      className={`${SHAPE} ${tone} ps-3 pe-0`}
      role="group"
      aria-label={label}
      data-set={set ? label : undefined}
    >
      <AriaButton {...rest} ref={buttonRef} className={`${CAPSULE_HIT} ${PRESS} h-full`}>
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

/** A React Aria link that navigates through the app's router, so it presses like a button. */
function CapsuleLink(props: AriaLinkProps & { ref?: Ref<HTMLAnchorElement> }) {
  const navigate = useNavigate()
  return (
    <AriaRouterProvider navigate={(path) => void navigate(path)} useHref={useHref}>
      <AriaLink {...props} />
    </AriaRouterProvider>
  )
}
