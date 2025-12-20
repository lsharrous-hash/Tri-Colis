import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import { login as apiLogin, setAuthToken } from '../lib/api'
import type { LoginResponse } from '../lib/api'

interface AuthState {
  token: string | null
  user: LoginResponse['user'] | null
}

interface AuthContextValue extends AuthState {
  login: (payload: LoginPayload) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

const STORAGE_KEY = 'tricoli.auth'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return { token: null, user: null }
      const parsed = JSON.parse(raw) as AuthState
      setAuthToken(parsed.token)
      return parsed
    } catch (e) {
      return { token: null, user: null }
    }
  })

  useEffect(() => {
    if (state.token) {
      setAuthToken(state.token)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } else {
      setAuthToken(null)
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [state])

  // Écouter l'événement global déclenché par l'intercepteur 401
  useEffect(() => {
    const handler = () => setState({ token: null, user: null })
    window.addEventListener('tricoli:auth-logout', handler)
    return () => window.removeEventListener('tricoli:auth-logout', handler)
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    token: state.token,
    user: state.user,
    login: async (payload: LoginPayload) => {
      const data = await apiLogin(payload)
      setState({ token: data.token, user: data.user })
    },
    logout: () => setState({ token: null, user: null }),
  }), [state])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth doit être utilisé dans AuthProvider')
  return ctx
}

// Définition locale pour éviter les erreurs d'import de type
export interface LoginPayload {
  login: string
  password: string
}
