import { IonApp } from '@ionic/react'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthGate } from './AuthGate'

// A size, weight, or tracking utility. A type role carries all three, so a screen that sets one
// of its own has stepped outside the roles. `text-xl` carries no digit; `text-2xl` and up do.
const AD_HOC_TYPE = /\btext-(xs|sm|base|lg|\d?xl)\b|\bfont-\w+\b|\btracking-\w+\b/

const clerk = vi.hoisted(() => ({ isLoaded: true }))

vi.mock('@clerk/react', () => ({
  useAuth: () => ({
    isLoaded: clerk.isLoaded,
    isSignedIn: false,
    userId: null,
    getToken: async () => null,
  }),
  SignIn: () => <div style={{ height: 2000 }}>Clerk sign-in form</div>,
}))

afterEach(() => {
  clerk.isLoaded = true
})

describe('AuthGate in the Ionic app', () => {
  it('shows a visible loading status while Clerk loads', async () => {
    const { page } = await import('vitest/browser')
    clerk.isLoaded = false
    render(
      <IonApp>
        <AuthGate>
          <p>signed in</p>
        </AuthGate>
      </IonApp>,
    )
    const status = page.getByRole('status', { name: 'Loading' })
    await expect.element(status).toBeVisible()
    // An element that draws nothing is still "visible" to the matcher, so check it has a size.
    await expect.poll(() => status.element().getBoundingClientRect().width).toBeGreaterThan(0)
  })

  it('scrolls a sign-in form taller than the screen', async () => {
    render(
      <IonApp>
        <AuthGate>
          <p>signed in</p>
        </AuthGate>
      </IonApp>,
    )
    const form = await screen.findByText('Clerk sign-in form')
    const scroller = form.closest('main')!.parentElement!
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight)
    scroller.scrollTop = 500
    expect(scroller.scrollTop).toBe(500)
  })

  it('sets the sign-in lockup in the app type role', async () => {
    render(
      <IonApp>
        <AuthGate>
          <p>signed in</p>
        </AuthGate>
      </IonApp>,
    )
    const lockup = await screen.findByText('Crosstune')
    expect(lockup.className).toMatch(/\btype-\S+/)
    expect(lockup.className).not.toMatch(AD_HOC_TYPE)
  })
})
