import { useAuthSession } from '../auth/AuthContext'
import { DbProvider } from '../db/DbProvider'
import { SyncProvider } from '../sync/SyncProvider'
import { App } from './App'
import type { AppRouter } from './router'

export function AppData({ router }: { router: AppRouter }) {
  const { userId } = useAuthSession()
  return (
    <DbProvider userId={userId}>
      <SyncProvider>
        <App router={router} />
      </SyncProvider>
    </DbProvider>
  )
}
