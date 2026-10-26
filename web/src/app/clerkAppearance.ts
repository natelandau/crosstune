import type { LocalizationResource } from '@clerk/react/types'
import { SIGN_UP_TITLE, WELCOME_REASON } from '../auth/links'

// Clerk renders these inside its own DOM, so the app's tokens reach it as CSS variables, which
// keeps the form in step with the color scheme.
export const APPEARANCE = {
  variables: {
    colorPrimary: 'var(--accent-fill)',
    colorPrimaryForeground: 'var(--on-accent-fill)',
    colorForeground: 'var(--ink)',
    colorMutedForeground: 'var(--ink-2)',
    colorMuted: 'var(--surface)',
    colorBackground: 'var(--ground)',
    colorInput: 'var(--field)',
    colorInputForeground: 'var(--ink)',
    // Clerk fades this to about a tenth for input borders, so it takes an opaque color; the
    // already translucent hairline would vanish.
    colorBorder: 'var(--ink)',
    colorDanger: 'var(--danger)',
    colorNeutral: 'var(--ink)',
    fontFamily: 'var(--font-sans)',
    borderRadius: 'var(--radius-row)',
  },
  elements: {
    rootBox: { width: '100%' },
    cardBox: {
      width: '100%',
      maxWidth: 'var(--container-auth)',
      boxShadow: 'none',
      borderRadius: 'var(--radius-surface)',
      border: '1px solid var(--hairline)',
    },
    card: { boxShadow: 'none', borderRadius: 'var(--radius-surface)' },
  },
}

/** Sign-up leads with the email field, Google and Apple an equal pair under it. Sign-in keeps
 * Clerk's own order. */
export const SIGN_UP_APPEARANCE = {
  ...APPEARANCE,
  options: {
    socialButtonsPlacement: 'bottom' as const,
    socialButtonsVariant: 'blockButton' as const,
  },
}

// The reason also rides on the code-entry step, where the sign-up title is Clerk's own.
export const LOCALIZATION = {
  signUp: {
    start: { title: SIGN_UP_TITLE, subtitle: WELCOME_REASON },
    emailCode: { subtitle: WELCOME_REASON },
  },
} satisfies LocalizationResource
