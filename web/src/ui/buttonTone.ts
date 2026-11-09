import type { ButtonVariant } from './Button'

/** An action's tone: `danger` for a destructive action, `warning` for a cautionary one. Both
 * take the destructive fill. */
export type ActionTone = 'danger' | 'warning'

// A disabled filled button drops its fill for a ring and a faint label, so it reads as off and
// never as another filled button.
const OFF =
  'off:bg-transparent off:text-on-disabled off:shadow-none off:ring-1 off:ring-disabled-border off:ring-inset'
/** Each variant's colors, for a control that draws its own shape in a button's tone. */
export const BUTTON_TONE: Record<ButtonVariant, string> = {
  primary: `bg-accent-fill font-semibold text-on-accent-fill shadow-(--shadow-highlight) hover:bg-accent-fill-hover ${OFF}`,
  secondary: `bg-tint font-semibold text-primary hover:bg-tint-strongest ${OFF}`,
  // A text button's words take the accent; a glyph alone stays primary text, except in a section
  // heading. The lighter hover keeps the accent at 4.5:1.
  text: 'text-accent hover:bg-tint-subtle',
  destructive: 'text-danger hover:bg-danger-subtle',
  // The on-status label inverts with the scheme: white on red in light, dark on a lighter red in
  // dark. Hover mixes toward primary text, darker in light, lighter in dark.
  destructiveFill: `bg-danger font-semibold text-on-status hover:bg-danger-hover ${OFF}`,
}

/** The corner of a button with a fill or a label. Only a bare glyph, a button in a bar, and the
 * transport are round. */
export const BUTTON_CORNER = 'rounded-(--radius)'

/** A button with no fill while it is off: dimmed, with no hover tint. */
export const UNFILLED_OFF = 'off:opacity-40 off:hover:bg-transparent'
