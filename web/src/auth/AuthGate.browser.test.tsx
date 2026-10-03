import { IonApp } from '@ionic/react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_DELETED, AuthGate } from './AuthGate'
import { SIGN_IN_HEADLINE } from './links'
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
  // Clerk's card is 25rem wide and narrows to the viewport less its own margin.
  SignIn: () => (
    <div style={{ height: 2000, width: '25rem', maxWidth: 'calc(100vw - 2.5rem)' }}>
      Clerk sign-in form
    </div>
  ),
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
    await expect.poll(() => scroller.scrollHeight - scroller.clientHeight).toBeGreaterThan(0)
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
    await expect.poll(hasAccountDeletedNotice).toBe(false)
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

  it.each(['focus', 'online'])('tries the sign-out again on %s after it failed', async (event) => {
    const signOut = vi.fn(async () => {
      throw new Error('clerk refused')
    })
    clerk.signOut = signOut
    markSignedOutLocally('user_gone')
    clerk.userId = 'user_gone'
    render(
      <IonApp>
        <AuthGate>
          <p>signed in</p>
        </AuthGate>
      </IonApp>,
    )
    await vi.waitFor(() => expect(signOut).toHaveBeenCalledOnce())
    // Let the failed attempt settle, so the next one is not refused as still in flight.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    await act(async () => {
      window.dispatchEvent(new Event(event))
    })
    await vi.waitFor(() => expect(signOut).toHaveBeenCalledTimes(2))
  })

  it('does not start a second sign-out while one is still running', async () => {
    let finish = () => {}
    const signOut = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    clerk.signOut = signOut
    markSignedOutLocally('user_gone')
    clerk.userId = 'user_gone'
    render(
      <IonApp>
        <AuthGate>
          <p>signed in</p>
        </AuthGate>
      </IonApp>,
    )
    await vi.waitFor(() => expect(signOut).toHaveBeenCalledOnce())
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('online'))
    })
    expect(signOut).toHaveBeenCalledOnce()
    await act(async () => finish())
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

describe('the sign-in screen layout', () => {
  async function renderAt(width: number, height = 800) {
    const { page } = await import('vitest/browser')
    await page.viewport(width, height)
    render(
      <IonApp>
        <AuthGate>
          <p>signed in</p>
        </AuthGate>
      </IonApp>,
    )
    const heading = await screen.findByRole('heading', { name: SIGN_IN_HEADLINE })
    const picture = screen.getByText('A: Cluck Old Hen').closest('[aria-hidden="true"]')!
    const form = screen.getByText('Clerk sign-in form')
    const scroller = heading.closest('main')!.parentElement!
    return { heading, picture, form, scroller }
  }

  async function expectNoSidewaysScroll(scroller: HTMLElement, form: HTMLElement) {
    await vi.waitFor(() => {
      expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth)
      expect(form.getBoundingClientRect().right).toBeLessThanOrEqual(scroller.clientWidth)
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
    })
  }

  afterEach(async () => {
    const { page } = await import('vitest/browser')
    await page.viewport(390, 844)
    delete document.documentElement.dataset.textSize
  })

  it('sets the picture above the heading on a phone', async () => {
    const { heading, picture } = await renderAt(375)
    await vi.waitFor(() => {
      const art = picture.getBoundingClientRect()
      expect(art.height).toBeGreaterThan(0)
      expect(art.bottom).toBeLessThanOrEqual(heading.getBoundingClientRect().top)
    })
  })

  it('starts the form high enough on a small phone to show its first field', async () => {
    const { form } = await renderAt(375, 667)
    // Leaves room on a 667px screen for Clerk's card head, social row, divider, and email
    // field, as measured in the real app. The e2e suite checks the real card itself.
    const FORM_TOP_BUDGET = 337
    await vi.waitFor(() => {
      expect(form.getBoundingClientRect().top).toBeLessThanOrEqual(FORM_TOP_BUDGET)
    })
  })

  it('sets the picture and the form in one row on a wide screen', async () => {
    const { picture, form } = await renderAt(1024)
    await vi.waitFor(() => {
      const art = picture.getBoundingClientRect()
      const box = form.getBoundingClientRect()
      expect(art.width).toBeGreaterThan(0)
      expect(art.right).toBeLessThanOrEqual(box.left)
      // Some vertical overlap: the two sit side by side, not stacked.
      expect(art.top).toBeLessThan(box.bottom)
      expect(box.top).toBeLessThan(art.bottom)
    })
  })

  it.each([320, 768])('never scrolls sideways at %ipx wide', async (width) => {
    const { scroller, form } = await renderAt(width)
    await expectNoSidewaysScroll(scroller, form)
  })

  it('never scrolls sideways on a wide screen at the largest text size', async () => {
    document.documentElement.dataset.textSize = 'roomy'
    const { scroller, form } = await renderAt(1024)
    await expectNoSidewaysScroll(scroller, form)
  })

  it.each([375, 1024])('keeps every paper line clear of the phone at %ipx wide', async (width) => {
    const { picture } = await renderAt(width)
    const phone = picture.querySelector('.paper-echo-phone')!
    await vi.waitFor(() => {
      const device = phone.getBoundingClientRect()
      expect(device.width).toBeGreaterThan(0)
      for (const line of picture.querySelectorAll('.paper-echo-paper p')) {
        const range = document.createRange()
        range.selectNodeContents(line)
        // Each glyph box, not the line's rotated bounding box, which would reach under the
        // phone even when no letter does.
        for (const glyphs of range.getClientRects()) {
          const overlaps =
            glyphs.left < device.right &&
            glyphs.right > device.left &&
            glyphs.top < device.bottom &&
            glyphs.bottom > device.top
          expect(overlaps, line.textContent!).toBe(false)
        }
      }
    })
  })
})
