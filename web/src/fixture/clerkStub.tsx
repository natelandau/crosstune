/* eslint-disable react-refresh/only-export-components -- it mirrors the package's exports */
import { useEffect, type CSSProperties, type ReactNode } from 'react'

// Stands in for `@clerk/react` in `just web::kit-shots`, which aliases the package to this
// module, and in browser tests that mock the package with it, so the sign-in screen renders with no Clerk instance and no network. Clerk's own
// form cannot render here; this one paints the same appearance variables the real form takes,
// so a capture still shows whether each resolves against the app's tokens.

interface Appearance {
  variables?: Record<string, string>
  elements?: Record<string, CSSProperties>
}

declare global {
  interface Window {
    /** The appearance the sign-in screen passed, for the capture script to check. */
    __clerkAppearance?: Appearance
  }
}

export function ClerkProvider({ children }: { children: ReactNode }) {
  return <>{children}</>
}

export function useAuth() {
  return {
    isLoaded: true,
    isSignedIn: true,
    userId: 'user_1',
    getToken: async () => 'token',
    signOut: async () => {},
  }
}

/** Who the stub says is signed in, for a screen that names the account. */
export const STUB_USER_NAME = 'Alex Rivera'
export const STUB_USER_EMAIL = 'alex@example.com'

const user = {
  fullName: STUB_USER_NAME,
  primaryEmailAddress: { emailAddress: STUB_USER_EMAIL },
}

export function useUser() {
  return { isLoaded: true, isSignedIn: true, user }
}

export function SignIn({ appearance = {} }: { appearance?: Appearance }) {
  useEffect(() => {
    window.__clerkAppearance = appearance
  }, [appearance])
  const v = appearance.variables ?? {}
  const el = appearance.elements ?? {}
  const field: CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '0.6rem 0.75rem',
    border: `1px solid ${v.colorBorder}`,
    borderRadius: v.borderRadius,
    background: v.colorInput,
    color: v.colorInputForeground,
    font: 'inherit',
  }
  return (
    <div style={el.rootBox}>
      <div style={{ ...el.cardBox, background: v.colorBackground, margin: '0 auto' }}>
        <div
          style={{
            ...el.card,
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            padding: '2rem 2.5rem',
            color: v.colorForeground,
            fontFamily: v.fontFamily,
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: '1.0625rem' }}>Sign in to Crosstune</div>
            <div style={{ color: v.colorMutedForeground, fontSize: '0.8125rem' }}>
              Welcome back! Please sign in to continue
            </div>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Email address</span>
            <input style={field} placeholder="Enter your email address" />
          </label>
          <button
            type="button"
            style={{
              ...field,
              background: v.colorPrimary,
              color: v.colorPrimaryForeground,
              border: 'none',
              fontWeight: 500,
            }}
          >
            Continue
          </button>
          <div
            style={{
              background: v.colorMuted,
              color: v.colorMutedForeground,
              fontSize: '0.75rem',
              textAlign: 'center',
              padding: '0.5rem',
              borderRadius: v.borderRadius,
            }}
          >
            Stand-in for Clerk&apos;s form
          </div>
        </div>
      </div>
    </div>
  )
}
