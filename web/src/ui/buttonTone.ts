import type { ButtonVariant } from './Button'

// A disabled filled button drops its fill for a ring and a faint label, so it reads as off and
// never as another filled button.
const OFF =
  'disabled:bg-transparent disabled:text-on-disabled disabled:shadow-none disabled:ring-1 disabled:ring-disabled-border disabled:ring-inset aria-disabled:bg-transparent aria-disabled:text-on-disabled aria-disabled:shadow-none aria-disabled:ring-1 aria-disabled:ring-disabled-border aria-disabled:ring-inset'
/** Each variant's colors, for a control that draws its own shape in a button's tone. */
export const BUTTON_TONE: Record<ButtonVariant, string> = {
  primary: `bg-accent-fill font-semibold text-on-accent-fill shadow-(--shadow-highlight) hover:bg-accent-fill-hover ${OFF}`,
  // A plain button's words take the accent; a glyph alone stays primary text, except in a section
  // heading. The lighter hover keeps the accent at 4.5:1.
  plain: 'text-accent hover:bg-tint-subtle',
  tinted: `bg-tint font-semibold text-primary hover:bg-tint-strongest ${OFF}`,
  // An outline, so a secondary action never reads like a filled button that is off.
  bordered: 'text-accent ring-1 ring-tint-strongest ring-inset hover:bg-tint-subtle',
  destructive: 'text-danger hover:bg-danger-subtle',
  warning: 'text-warning hover:bg-warning-subtle',
  // The on-status label inverts with the scheme: white on red in light, dark on a lighter red in
  // dark. Hover mixes toward primary text, darker in light, lighter in dark.
  destructiveFill: `bg-danger font-semibold text-on-status hover:bg-danger-hover ${OFF}`,
  warningFill: `bg-warning-fill font-semibold text-on-warning-fill hover:bg-warning-fill-hover ${OFF}`,
}

/** The corner of a button with a fill or a label. Only a bare glyph, a button in a bar, and the
 * transport are round. */
export const BUTTON_CORNER = 'rounded-(--radius-control)'

/** A button with no fill while it is off: dimmed, with no hover tint. */
export const UNFILLED_OFF =
  'disabled:opacity-40 disabled:hover:bg-transparent aria-disabled:opacity-40 aria-disabled:hover:bg-transparent'

/** A plain button that is a glyph alone, such as a row's or a bar's icon control. */
export const PLAIN_GLYPH = 'text-primary hover:bg-tint-strong'
