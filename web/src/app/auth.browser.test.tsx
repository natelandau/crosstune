import { act, renderHook, screen } from '@testing-library/react'
import { page } from 'vitest/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthSession } from '../auth/AuthContext'
import {
  NEXT_SLIDE,
  SIGN_IN_HEADLINE,
  SIGN_IN_PATH,
  SIGN_UP_PATH,
  SLIDE_COUNT,
  slideDotLabel,
  SPLASH_LABEL,
  WELCOME_REASON,
} from '../auth/links'
import {
  ACCOUNT_DELETED,
  clearAccountDeletedNotice,
  clearLocalSignOut,
  hasAccountDeletedNotice,
  markAccountDeleted,
  markSignedOutLocally,
  rememberedUser,
  rememberUser,
} from '../auth/session'
import { readSearchQuery, writeSearchQuery } from '../ui/searchSession'
import { CLERK_LOAD_GRACE_MS, useAuthGate, type GateClock } from '../auth/useAuthGate'
import { computedColor } from '../test/color'
import { renderWithProviders } from '../test/render'
import { AuthGate } from './AuthGate'

const clerk = vi.hoisted(() => ({
  isLoaded: true,
  userId: null as string | null,
  signOut: async () => {},
  token: 'token',
  // The props each Clerk form last received.
  signIn: {} as Record<string, unknown>,
  signUp: {} as Record<string, unknown>,
}))

vi.mock('@clerk/react', () => ({
  useAuth: () => ({
    isLoaded: clerk.isLoaded,
    isSignedIn: clerk.userId !== null,
    userId: clerk.userId,
    getToken: async () => clerk.token,
    signOut: clerk.signOut,
  }),
  useUser: () => ({ isLoaded: clerk.isLoaded, user: null }),
  SignIn: (props: Record<string, unknown>) => {
    clerk.signIn = props
    return (
      <div
        style={{ height: 600, width: 'var(--container-auth)', maxWidth: 'calc(100vw - 2.5rem)' }}
      >
        Clerk sign-in form
      </div>
    )
  },
  SignUp: (props: Record<string, unknown>) => {
    clerk.signUp = props
    return <div>Clerk sign-up form</div>
  },
}))

const START_URL = location.href

/** A clock the test advances by hand, so the grace period never waits on real time. */
function fakeClock() {
  let pending: (() => void) | null = null
  let delay: number | null = null
  let starts = 0
  const clock: GateClock = {
    setTimer: (callback, ms) => {
      pending = callback
      delay = ms
      starts += 1
      return 1
    },
    clearTimer: () => {
      pending = null
    },
  }
  return {
    clock,
    fire: () => act(() => pending?.()),
    isPending: () => pending !== null,
    delay: () => delay,
    starts: () => starts,
  }
}

function Child() {
  const session = useAuthSession()
  return (
    <p>
      user:{session.userId} offline:{String(session.offline)}
    </p>
  )
}

function setOnline(online: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online)
}

beforeEach(() => {
  clerk.isLoaded = true
  clerk.userId = null
  clerk.signOut = async () => {}
  clerk.token = 'token'
  clerk.signIn = {}
  clerk.signUp = {}
  setOnline(true)
})

afterEach(() => {
  // The mark lives in module memory as well as storage, so the setup's storage reset misses it.
  clearLocalSignOut()
  clearAccountDeletedNotice()
  history.replaceState(null, '', START_URL)
  vi.restoreAllMocks()
})

describe('useAuthGate', () => {
  it('stays on the splash until the grace time ends, then admits a remembered user', () => {
    clerk.isLoaded = false
    rememberUser('user_1')
    const { clock, fire, isPending, delay } = fakeClock()
    const { result } = renderHook(() => useAuthGate(clock))
    expect(result.current.state).toBe('splash')
    expect(isPending()).toBe(true)
    expect(delay()).toBe(CLERK_LOAD_GRACE_MS)
    fire()
    expect(result.current).toMatchObject({ state: 'offline', userId: 'user_1' })
  })

  it('admits a remembered user at once when the browser reports no connection', () => {
    clerk.isLoaded = false
    setOnline(false)
    rememberUser('user_1')
    const { result } = renderHook(() => useAuthGate(fakeClock().clock))
    expect(result.current.state).toBe('offline')
  })

  it('never admits an unremembered user without Clerk', () => {
    clerk.isLoaded = false
    const { clock, fire } = fakeClock()
    const { result } = renderHook(() => useAuthGate(clock))
    fire()
    expect(result.current.state).toBe('splash')
  })

  it('signs in and remembers the user once Clerk has loaded', () => {
    clerk.userId = 'user_2'
    const { result } = renderHook(() => useAuthGate(fakeClock().clock))
    expect(result.current).toMatchObject({ state: 'signedIn', userId: 'user_2' })
    expect(rememberedUser()).toBe('user_2')
  })

  it('shows sign-in for a user signed out locally and ends Clerk session', async () => {
    const signOut = vi.fn(async () => {})
    clerk.signOut = signOut
    clerk.userId = 'user_gone'
    markSignedOutLocally('user_gone')
    const { result } = renderHook(() => useAuthGate(fakeClock().clock))
    expect(result.current).toMatchObject({ state: 'signIn', staleSession: true })
    await expect.poll(() => signOut.mock.calls.length).toBe(1)
  })

  it.each(['focus', 'online'])('tries the sign-out again on %s after it failed', async (event) => {
    const signOut = vi.fn(async () => {
      throw new Error('clerk refused')
    })
    clerk.signOut = signOut
    clerk.userId = 'user_gone'
    markSignedOutLocally('user_gone')
    renderHook(() => useAuthGate(fakeClock().clock))
    await expect.poll(() => signOut.mock.calls.length).toBe(1)
    // The listener calls signOut synchronously, so each poll adds at most one attempt, and one
    // lands once the failed attempt has settled.
    await expect
      .poll(() => {
        window.dispatchEvent(new Event(event))
        return signOut.mock.calls.length
      })
      .toBe(2)
  })

  it('starts no second sign-out while one is still running', async () => {
    let resolve = () => {}
    const signOut = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done
        }),
    )
    clerk.signOut = signOut
    clerk.userId = 'user_gone'
    markSignedOutLocally('user_gone')
    renderHook(() => useAuthGate(fakeClock().clock))
    await expect.poll(() => signOut.mock.calls.length).toBe(1)
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))
    // Each listener runs inside dispatchEvent, so the count is final here.
    expect(signOut).toHaveBeenCalledOnce()
    await act(async () => resolve())
  })

  it('forgets the user and their searches once signed out', () => {
    rememberUser('user_1')
    writeSearchQuery('catalog', 'soldier')
    writeSearchQuery('recordings', 'jig')
    renderHook(() => useAuthGate(fakeClock().clock))
    expect(rememberedUser()).toBeNull()
    expect(readSearchQuery('catalog')).toBe('')
    expect(readSearchQuery('recordings')).toBe('')
  })

  it('hands out one token getter that follows the Clerk state', async () => {
    clerk.userId = 'user_1'
    clerk.token = 'live'
    const { result, rerender } = renderHook(() => useAuthGate(fakeClock().clock))
    const getToken = result.current.getToken
    await expect(getToken()).resolves.toBe('live')
    clerk.userId = null
    rerender()
    expect(result.current.getToken).toBe(getToken)
    await expect(getToken()).resolves.toBeNull()
  })
})

it('starts the grace timer once when the caller passes a new clock each render', () => {
  clerk.isLoaded = false
  const { clock, starts } = fakeClock()
  const { rerender } = renderHook(() => useAuthGate({ ...clock }))
  rerender()
  rerender()
  expect(starts()).toBe(1)
})

describe('AuthGate', () => {
  it('shows the named loading status while Clerk loads', async () => {
    clerk.isLoaded = false
    renderWithProviders(
      <AuthGate>
        <p>signed in</p>
      </AuthGate>,
    )
    const status = page.getByRole('status', { name: SPLASH_LABEL })
    await expect.element(status).toBeVisible()
    await expect.poll(() => status.element().getBoundingClientRect().width).toBeGreaterThan(0)
    expect(screen.queryByText(SIGN_IN_HEADLINE)).toBeNull()
  })

  it('shows the sign-in headline, line, and form when signed out', async () => {
    renderWithProviders(
      <AuthGate>
        <p>signed in</p>
      </AuthGate>,
    )
    await expect
      .element(page.getByRole('heading', { name: SIGN_IN_HEADLINE, level: 1 }))
      .toBeVisible()
    await expect.element(page.getByText(WELCOME_REASON)).toBeVisible()
    await expect.element(page.getByText('Crosstune')).toBeVisible()
    await expect.element(page.getByText('Clerk sign-in form')).toBeVisible()
  })

  it('renders the children inside the session when signed in', async () => {
    clerk.userId = 'user_3'
    renderWithProviders(
      <AuthGate>
        <Child />
      </AuthGate>,
    )
    await expect.element(page.getByText('user:user_3 offline:false')).toBeVisible()
  })

  it('admits a remembered user offline once the browser reports no connection', async () => {
    clerk.isLoaded = false
    setOnline(false)
    rememberUser('user_4')
    renderWithProviders(
      <AuthGate>
        <Child />
      </AuthGate>,
    )
    await expect.element(page.getByText('user:user_4 offline:true')).toBeVisible()
  })

  it('keeps a locally signed-out user out and ends the session Clerk still holds', async () => {
    const signOut = vi.fn(async () => {})
    clerk.signOut = signOut
    clerk.userId = 'user_gone'
    markAccountDeleted()
    markSignedOutLocally('user_gone')
    renderWithProviders(
      <AuthGate>
        <p>signed in</p>
      </AuthGate>,
    )
    await expect.element(page.getByText(ACCOUNT_DELETED)).toBeVisible()
    await expect.poll(() => signOut.mock.calls.length).toBe(1)
    expect(screen.queryByText('signed in')).toBeNull()
    expect(screen.queryByText('Clerk sign-in form')).toBeNull()
  })

  it('leaves the app once the local sign-out is marked', async () => {
    clerk.userId = 'user_gone'
    renderWithProviders(
      <AuthGate>
        <p>signed in</p>
      </AuthGate>,
    )
    await expect.element(page.getByText('signed in')).toBeVisible()
    act(() => markSignedOutLocally('user_gone'))
    await expect.element(page.getByText('signed in')).not.toBeInTheDocument()
  })

  it('keeps the account-deleted notice across remounts until someone signs in', async () => {
    markAccountDeleted()
    const gate = (
      <AuthGate>
        <p>signed in</p>
      </AuthGate>
    )
    const first = renderWithProviders(gate)
    await expect
      .element(page.getByRole('status').filter({ hasText: ACCOUNT_DELETED }))
      .toBeVisible()
    first.unmount()
    // A reload lands on the sign-in screen again, and the notice with it.
    const second = renderWithProviders(gate)
    await expect
      .element(page.getByRole('status').filter({ hasText: ACCOUNT_DELETED }))
      .toBeVisible()
    second.unmount()
    clerk.userId = 'user_next'
    renderWithProviders(gate)
    await expect.element(page.getByText('signed in')).toBeVisible()
    expect(hasAccountDeletedNotice()).toBe(false)
  })

  it.each([SIGN_UP_PATH, `${SIGN_UP_PATH}/`])(
    'shows the sign-up screen at %s when signed out',
    async (path) => {
      history.replaceState(null, '', path)
      renderWithProviders(
        <AuthGate>
          <p>signed in</p>
        </AuthGate>,
      )
      await expect
        .element(page.getByRole('heading', { name: SIGN_IN_HEADLINE, level: 1 }))
        .toBeVisible()
      await expect.element(page.getByText('Clerk sign-up form')).toBeVisible()
      // Clerk's own subtitle carries the reason on sign-up.
      expect(screen.queryByText(WELCOME_REASON)).toBeNull()
      expect(screen.queryByText('Clerk sign-in form')).toBeNull()
    },
  )

  it('shows the sign-in screen anywhere else when signed out', async () => {
    history.replaceState(null, '', '/catalog')
    renderWithProviders(
      <AuthGate>
        <p>signed in</p>
      </AuthGate>,
    )
    await expect.element(page.getByText('Clerk sign-in form')).toBeVisible()
    expect(screen.queryByText('Clerk sign-up form')).toBeNull()
  })

  it('links each Clerk form to the other screen', async () => {
    const gate = (
      <AuthGate>
        <p>signed in</p>
      </AuthGate>
    )
    const first = renderWithProviders(gate)
    await expect.element(page.getByText('Clerk sign-in form')).toBeVisible()
    expect(clerk.signIn).toMatchObject({ routing: 'hash', signUpUrl: SIGN_UP_PATH })
    first.unmount()
    history.replaceState(null, '', SIGN_UP_PATH)
    renderWithProviders(gate)
    await expect.element(page.getByText('Clerk sign-up form')).toBeVisible()
    expect(clerk.signUp).toMatchObject({ routing: 'hash', signInUrl: SIGN_IN_PATH })
  })

  it("dresses sign-up like sign-in, and moves only sign-up's social buttons", async () => {
    const gate = (
      <AuthGate>
        <p>signed in</p>
      </AuthGate>
    )
    const first = renderWithProviders(gate)
    await expect.element(page.getByText('Clerk sign-in form')).toBeVisible()
    first.unmount()
    history.replaceState(null, '', SIGN_UP_PATH)
    renderWithProviders(gate)
    await expect.element(page.getByText('Clerk sign-up form')).toBeVisible()
    expect(clerk.signIn.appearance).toBeDefined()
    expect(clerk.signIn.appearance).not.toHaveProperty('options')
    expect(clerk.signUp.appearance).toMatchObject(clerk.signIn.appearance as object)
    expect(clerk.signUp.appearance).toHaveProperty('options.socialButtonsPlacement', 'bottom')
  })
})

describe('the sign-in layout', () => {
  afterEach(async () => {
    await page.viewport(390, 844)
  })

  async function renderAt(width: number, density: 'touch' | 'pointer' = 'pointer', height = 800) {
    await page.viewport(width, height)
    renderWithProviders(
      <AuthGate>
        <p>signed in</p>
      </AuthGate>,
      { density },
    )
    const heading = page.getByRole('heading', { name: SIGN_IN_HEADLINE })
    await expect.element(heading).toBeVisible()
    return { heading: heading.element(), form: page.getByText('Clerk sign-in form').element() }
  }

  it('sets the lockup and headline beside the form on a wide screen', async () => {
    const { heading, form } = await renderAt(1200)
    await expect
      .poll(() => heading.getBoundingClientRect().right <= form.getBoundingClientRect().left)
      .toBe(true)
  })

  it('stacks the headline above the form on a phone', async () => {
    const { heading, form } = await renderAt(375)
    await expect
      .poll(() => heading.getBoundingClientRect().bottom <= form.getBoundingClientRect().top)
      .toBe(true)
  })

  it("paints the lockup's T in coral", async () => {
    await renderAt(390)
    const t = document.querySelector('main svg path')!
    const coral = getComputedStyle(document.documentElement).getPropertyValue('--coral').trim()
    await expect.poll(() => getComputedStyle(t).stroke).toBe(computedColor(coral))
  })

  it('sets the account-deleted notice above the form, beside the carousel', async () => {
    markAccountDeleted()
    const { heading, form } = await renderAt(1200)
    const notice = page.getByRole('status').filter({ hasText: ACCOUNT_DELETED })
    await expect.element(notice).toBeVisible()
    await expect
      .poll(() => {
        const box = notice.element().getBoundingClientRect()
        return (
          box.left >= heading.getBoundingClientRect().right &&
          box.bottom <= form.getBoundingClientRect().top
        )
      })
      .toBe(true)
  })

  // The arrows follow the carousel's width, not the window's frame, so a short wide window
  // keeps them, and they end at the stage's trailing edge whether the page splits or stacks.
  it.each([
    ['split in a short window', 1280, 550, true],
    ['stacked', 768, 800, false],
  ] as const)('sets the arrows beside the stage when %s', async (_, width, height, split) => {
    const { form } = await renderAt(width, 'pointer', height)
    const next = page.getByRole('button', { name: NEXT_SLIDE })
    await expect.element(next).toBeVisible()
    const stage = document.querySelector('[data-slide-stage]')!
    await expect
      .poll(() =>
        Math.abs(
          next.element().getBoundingClientRect().right - stage.getBoundingClientRect().right,
        ),
      )
      .toBeLessThan(4)
    if (split) {
      await expect
        .poll(
          () => next.element().getBoundingClientRect().right <= form.getBoundingClientRect().left,
        )
        .toBe(true)
    }
  })

  it('hides the arrows at phone width', async () => {
    await renderAt(390, 'touch', 844)
    await expect
      .element(page.getByRole('button', { name: slideDotLabel(SLIDE_COUNT) }))
      .toBeVisible()
    await expect
      .element(page.getByRole('button', { name: NEXT_SLIDE, includeHidden: true }))
      .not.toBeVisible()
  })

  it.each([
    [320, 'touch'],
    [320, 'pointer'],
    [768, 'touch'],
    [768, 'pointer'],
    [1200, 'touch'],
    [1200, 'pointer'],
  ] as const)('never scrolls sideways at %ipx with %s density', async (width, density) => {
    await renderAt(width, density)
    await expect.poll(() => document.documentElement.scrollWidth <= window.innerWidth).toBe(true)
  })
})
