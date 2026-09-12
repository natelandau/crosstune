import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type * as ApiClientModule from './api/client'
import { App } from './App'
import { createFakeApi } from './test/fakeApi'

vi.mock('@clerk/react', () => ({
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: true,
    userId: 'user_1',
    getToken: async () => 'tok',
  }),
  SignIn: () => null,
}))

vi.mock('./api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClientModule>()),
  createApiClient: () => createFakeApi().api,
}))

describe('App', () => {
  it('renders the catalog route and the dock for a signed-in user', async () => {
    render(<App />)
    expect(await screen.findByRole('searchbox', { name: 'Search songs' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument()
  })
})
