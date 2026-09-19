import { useAuthSession } from '../auth/AuthContext'
import { AuthGate } from '../auth/AuthGate'
import { DbProvider } from '../db/DbProvider'
import { SyncProvider } from '../sync/SyncProvider'
import { Shell } from './Shell'

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
        <Shell />
      </SyncProvider>
    </DbProvider>
  )
}
