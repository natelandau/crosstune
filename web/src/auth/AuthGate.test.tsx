import { act, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readSearchQuery, writeSearchQuery } from '../features/catalog/searchSession'
import { useAuthSession } from './AuthContext'
import { AuthGate, CLERK_LOAD_GRACE_MS } from './AuthGate'
import { rememberedUser, rememberUser } from './session'

interface FakeAuth {
  isLoaded: boolean
  isSignedIn: boolean
  userId: string | null
  getToken: () => Promise<string | null>
}

let auth: FakeAuth

vi.mock('@clerk/react', () => ({
  useAuth: () => auth,
  SignIn: () => <div>Clerk sign-in form</div>,
}))

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
  localStorage.clear()
  setOnline(true)
  auth = { isLoaded: false, isSignedIn: false, userId: null, getToken: async () => null }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AuthGate', () => {
  it('renders children and remembers the user when signed in', () => {
    auth = { isLoaded: true, isSignedIn: true, userId: 'user_1', getToken: async () => 't' }
    render(
      <AuthGate>
        <Child />
      </AuthGate>,
    )
    expect(screen.getByText('user:user_1 offline:false')).toBeInTheDocument()
    expect(rememberedUser()).toBe('user_1')
  })

  it('shows sign-in and forgets the user and their search when signed out', () => {
    rememberUser('user_1')
    writeSearchQuery('soldier')
    auth = { isLoaded: true, isSignedIn: false, userId: null, getToken: async () => null }
    render(
      <AuthGate>
        <Child />
      </AuthGate>,
    )
    expect(screen.getByText('Clerk sign-in form')).toBeInTheDocument()
    const lockup = screen.getByText('Crosstune')
    expect(lockup.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    expect(rememberedUser()).toBeNull()
    expect(readSearchQuery()).toBe('')
  })

  it('opens the remembered user offline when Clerk cannot load', () => {
    rememberUser('user_1')
    setOnline(false)
    render(
      <AuthGate>
        <Child />
      </AuthGate>,
    )
    expect(screen.getByText('user:user_1 offline:true')).toBeInTheDocument()
  })

  it('opens the remembered user after the grace period when Clerk is slow', () => {
    vi.useFakeTimers()
    rememberUser('user_1')
    render(
      <AuthGate>
        <Child />
      </AuthGate>,
    )
    expect(screen.getByLabelText('Loading')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(CLERK_LOAD_GRACE_MS)
    })
    expect(screen.getByText('user:user_1 offline:true')).toBeInTheDocument()
  })

  it('shows the splash with nothing remembered', () => {
    render(
      <AuthGate>
        <Child />
      </AuthGate>,
    )
    expect(screen.getByLabelText('Loading')).toBeInTheDocument()
  })

  it('hands down a token getter that follows the Clerk state', async () => {
    auth = { isLoaded: true, isSignedIn: true, userId: 'user_1', getToken: async () => 'live' }
    const holder: { getToken?: () => Promise<string | null> } = {}
    function Capture() {
      const { getToken } = useAuthSession()
      useEffect(() => {
        holder.getToken = getToken
      })
      return null
    }
    render(
      <AuthGate>
        <Capture />
      </AuthGate>,
    )
    await expect(holder.getToken!()).resolves.toBe('live')
  })
})
