import type { ButtonVariant } from './Button'

/** An action's tone: `danger` for a destructive action, `warning` for a cautionary one. */
export type ActionTone = 'danger' | 'warning'

/** The filled button for an action's tone, shared by a sheet's primary and an alert's action. */
export const TONE_VARIANT = {
  danger: 'destructiveFill',
  warning: 'warningFill',
} as const satisfies Record<ActionTone, ButtonVariant>
