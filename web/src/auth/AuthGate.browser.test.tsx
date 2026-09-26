import { IonApp } from '@ionic/react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_DELETED, AuthGate } from './AuthGate'
import {
  clearAccountDeletedNotice,
  clearLocalSignOut,
  hasAccountDeletedNotice,
  markAccountDeleted,
  markSignedOutLocally,
} from './session'

// A size, weight, or tracking utility. A type role carries all three, so a screen that sets one
// of its own has stepped outside the roles. `text-xl` carries no digit; `text-2xl` and up do.
const AD_HOC_TYPE = /\btext-(xs|sm|base|lg|\d?xl)\b|\bfont-\w+\b|\btracking-\w+\b/

const clerk = vi.hoisted(() => ({
  isLoaded: true,
  userId: null as string | null,
  signOut: async () => {},
}))

vi.mock('@clerk/react', () => ({
  useAuth: () => ({
    isLoaded: clerk.isLoaded,
    isSignedIn: clerk.userId !== null,
    userId: clerk.userId,
    getToken: async () => null,
    signOut: clerk.signOut,
  }),
  SignIn: () => <div style={{ height: 2000 }}>Clerk sign-in form</div>,
}))

afterEach(() => {
  clerk.isLoaded = true
  clerk.userId = null
  clerk.signOut = async () => {}
  clearAccountDeletedNotice()
  clearLocalSignOut()
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

  it('keeps the account-deleted notice across remounts until someone signs in', async () => {
    markAccountDeleted()
    const { unmount } = render(
      <IonApp>
        <AuthGate>
          <p>signed in</p>
        </AuthGate>
      </IonApp>,
    )
    const notice = await screen.findByText(ACCOUNT_DELETED)
    expect(notice).toHaveAttribute('role', 'status')
    unmount()

    // A reload lands on the sign-in screen again, and the notice with it.
    const second = render(
      <IonApp>
        <AuthGate>
          <p>signed in</p>
        </AuthGate>
      </IonApp>,
    )
    await screen.findByText(ACCOUNT_DELETED)
    second.unmount()

    clerk.userId = 'user_next'
    render(
      <IonApp>
        <AuthGate>
          <p>signed in</p>
        </AuthGate>
      </IonApp>,
    )
    await screen.findByText('signed in')
    expect(hasAccountDeletedNotice()).toBe(false)
  })

  it('ends a session Clerk still holds for a locally signed-out user instead of showing sign-in', async () => {
    const signOut = vi.fn(async () => {})
    clerk.signOut = signOut
    markAccountDeleted()
    markSignedOutLocally('user_gone')
    clerk.userId = 'user_gone'
    render(
      <IonApp>
        <AuthGate>
          <p>signed in</p>
        </AuthGate>
      </IonApp>,
    )
    await screen.findByText(ACCOUNT_DELETED)
    expect(screen.queryByText('Clerk sign-in form')).toBeNull()
    expect(screen.queryByText('signed in')).toBeNull()
    await vi.waitFor(() => expect(signOut).toHaveBeenCalledOnce())
    // The musician has not signed in again, so the notice stays.
    expect(hasAccountDeletedNotice()).toBe(true)
  })

  it('leaves the sign-in screen once the local sign-out is marked', async () => {
    clerk.userId = 'user_gone'
    render(
      <IonApp>
        <AuthGate>
          <p>signed in</p>
        </AuthGate>
      </IonApp>,
    )
    await screen.findByText('signed in')
    act(() => markSignedOutLocally('user_gone'))
    await vi.waitFor(() => expect(screen.queryByText('signed in')).toBeNull())
  })
})
