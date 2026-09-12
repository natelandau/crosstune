import { createContext, useContext } from 'react'

export interface AuthSession {
  userId: string
  getToken: () => Promise<string | null>
  offline: boolean
}

const AuthContext = createContext<AuthSession | null>(null)

export const AuthProvider = AuthContext.Provider

// AuthProvider re-exports Context.Provider directly, so this file mixes a component
// export with a hook export; that pairing is the point of a context module.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuthSession(): AuthSession {
  const session = useContext(AuthContext)
  if (!session) throw new Error('useAuthSession must be used inside AuthGate')
  return session
}
