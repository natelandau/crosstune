import { ClerkProvider } from '@clerk/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AnalyticsProvider } from './analytics/AnalyticsProvider'
import { WAITLIST_URL } from './auth/links'
import { createAppRouter } from './app/router'
import { AuthGate } from './app/AuthGate'
import { AppData } from './app/AppData'
import { startServices } from './app/startServices'
import './app.css'

function mountApp(element: HTMLElement) {
  // Started before the key check, so a build missing its key still reports the throw.
  const analytics = startServices()
  const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
  if (!clerkKey) throw new Error('VITE_CLERK_PUBLISHABLE_KEY is not set')
  const router = createAppRouter()
  createRoot(element).render(
    <StrictMode>
      <ClerkProvider publishableKey={clerkKey} waitlistUrl={WAITLIST_URL}>
        <AnalyticsProvider client={analytics}>
          <AuthGate>
            <AppData router={router} />
          </AuthGate>
        </AnalyticsProvider>
      </ClerkProvider>
    </StrictMode>,
  )
}

const root = document.getElementById('root')!
const params = new URLSearchParams(location.search)
// The fixture is a development aid for the screenshot script; a build drops this branch.
if (import.meta.env.DEV && params.has('fixture')) {
  void import('./fixture/mountFixture').then(({ mountFixture }) => mountFixture(root, params))
} else {
  mountApp(root)
}
