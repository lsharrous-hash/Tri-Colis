import { FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'

export function Login() {
  const [loginValue, setLoginValue] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const { login } = useAuth()

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: () => {
      navigate('/')
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || 'Identifiants incorrects'
      setError(msg)
    },
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    mutation.mutate({ login: loginValue, password })
  }

  return (
    <div className="surface" style={{ maxWidth: 420, margin: '0 auto' }}>
      <h1 className="title">Connexion</h1>
      <p className="muted">Accédez au tableau de bord web Tri Colis.</p>
      <form onSubmit={onSubmit} className="stack" style={{ marginTop: 20 }}>
        <div className="input-group">
          <label htmlFor="login">Identifiant</label>
          <input
            id="login"
            type="text"
            placeholder="admin"
            value={loginValue}
            onChange={(e) => setLoginValue(e.target.value)}
            required
            autoComplete="username"
          />
        </div>
        <div className="input-group">
          <label htmlFor="password">Mot de passe</label>
          <input
            id="password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>
        {error && <p className="muted" style={{ color: '#f87b7b' }}>{error}</p>}
        <button type="submit" className="btn" disabled={mutation.isPending}>
          {mutation.isPending ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
    </div>
  )
}
