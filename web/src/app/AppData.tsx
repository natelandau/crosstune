import { useAuth } from '@clerk/react'
import { AnalyticsIdentity } from '../usage/AnalyticsIdentity'
import { useAuthSession } from '../auth/AuthContext'
import { DbProvider } from '../db/DbProvider'
import { useCloseOnSignOutElsewhere } from '../features/settings/useCloseOnSignOutElsewhere'
import { useForgetAccountDeletedElsewhere } from '../features/settings/useForgetAccountDeletedElsewhere'
import { SyncProvider } from '../sync/SyncProvider'
import { App } from './App'
import type { AppRouter } from './router'

export function AppData({ router }: { router: AppRouter }) {
  const { userId } = useAuthSession()
  return (
    <DbProvider userId={userId}>
      <AnalyticsIdentity />
      <SyncProvider>
        <ForgetAccountDeletedElsewhere />
        <CloseOnSignOutElsewhere />
        <App router={router} />
      </SyncProvider>
    </DbProvider>
  )
}

function ForgetAccountDeletedElsewhere() {
  useForgetAccountDeletedElsewhere(useAuth().signOut)
  return null
}

function CloseOnSignOutElsewhere() {
  useCloseOnSignOutElsewhere()
  return null
}
