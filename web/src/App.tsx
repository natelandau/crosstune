import { RouterProvider } from '@tanstack/react-router'
import { useAuthSession } from './auth/AuthContext'
import { AuthGate } from './auth/AuthGate'
import { DbProvider } from './db/DbProvider'
import { router } from './router'
import { SyncProvider } from './sync/SyncProvider'

export function App() {
  return (
    <AuthGate>
      <Session />
    </AuthGate>
  )
}

function Session() {
  const { userId } = useAuthSession()
  return (
    <DbProvider userId={userId}>
      <SyncProvider>
        <RouterProvider router={router} />
      </SyncProvider>
    </DbProvider>
  )
}
