// Clerk renders these inside its own DOM, so the app's tokens reach it as CSS variables, which
// keeps the form in step with the color scheme.
export const APPEARANCE = {
  variables: {
    colorPrimary: 'var(--slate)',
    colorPrimaryForeground: 'var(--on-slate)',
    colorForeground: 'var(--ink)',
    colorMutedForeground: 'var(--ink-2)',
    colorMuted: 'var(--fill)',
    colorBackground: 'var(--ground)',
    colorInput: 'var(--ground)',
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
      maxWidth: '25rem',
      boxShadow: 'none',
      borderRadius: 'var(--radius-surface)',
      border: '1px solid var(--hairline)',
    },
    card: { boxShadow: 'none', borderRadius: 'var(--radius-surface)' },
  },
}
