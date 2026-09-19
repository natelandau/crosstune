import type { ReactNode } from 'react'

const BASE =
  'inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full px-3 type-subheadline tabular-nums'

/**
 * A capsule: a pressable rail or pill control when it has onPress, a static badge otherwise.
 * The 32px capsule sits in a 44px hit area so a tap target never shrinks.
 */
export function Capsule({
  children,
  pressed,
  filled,
  onPress,
  label,
  tone = 'neutral',
}: {
  children: ReactNode
  pressed?: boolean
  /** The same filled look as a pressed capsule, for a capsule that is not a toggle (a
   * remove action, say), so it never announces `aria-pressed`. */
  filled?: boolean
  onPress?: () => void
  label?: string
  tone?: 'neutral' | 'warning' | 'danger'
}) {
  const fill =
    pressed || filled
      ? 'bg-(--ion-color-primary) text-(--ion-color-primary-contrast)'
      : tone === 'warning'
        ? 'bg-(--ion-color-warning) text-(--ion-color-warning-contrast)'
        : tone === 'danger'
          ? 'bg-(--ion-color-danger) text-(--ion-color-danger-contrast)'
          : 'bg-(--fill-tertiary) text-(--ion-text-color)'
  if (!onPress) return <span className={`${BASE} ${fill}`}>{children}</span>
  return (
    <PressTarget pressed={pressed} onPress={onPress} label={label}>
      <span className={`${BASE} ${fill}`}>{children}</span>
    </PressTarget>
  )
}

/**
 * The 44px hit area a rail control sits in, with the pressed state it announces. Separate from
 * `Capsule` so a control that paints its own face, such as a key pill, gets the same target
 * without `Capsule` having to know what is inside it.
 */
export function PressTarget({
  children,
  pressed,
  onPress,
  label,
}: {
  children: ReactNode
  pressed?: boolean
  onPress: () => void
  label?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      className="grid min-h-11 min-w-11 shrink-0 place-items-center"
      onClick={onPress}
    >
      {children}
    </button>
  )
}
