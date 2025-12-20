import { ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const isLogin = location.pathname === '/login'
  const { token, user, logout } = useAuth()

  // Déterminer le texte du lien selon le rôle
  const isDispatcher = user?.role === 'DISPATCHER'
  const usersLinkText = isDispatcher ? '👤 Mon profil' : 'Utilisateurs'

  return (
    <div className="app-shell">
      <header className="nav">
        <div className="actions">
          <span className="brand">Trizee</span>
          <span className="pill">Web</span>
        </div>
        <div className="actions">
          {!isLogin && token && (
            <span className="pill">{user?.login} · {user?.role}</span>
          )}
          {!isLogin && token && (
            <button className="ghost-btn" onClick={logout} style={{ color: '#f87b7b' }}>
              Déconnexion
            </button>
          )}
          {!isLogin && !token && (
            <button className="ghost-btn" onClick={() => navigate('/login')}>
              Connexion
            </button>
          )}
          <Link to="/" className="ghost-btn">
            Tableau de bord
          </Link>
          <Link to="/tours-import" className="ghost-btn">
            Tournées & Import
          </Link>
          {/* Rapport de tri uniquement pour ADMIN */}
          {user?.role === 'ADMIN' && (
            <Link to="/scan-report" className="ghost-btn" style={{ 
              background: location.pathname === '/scan-report' ? 'rgba(34, 197, 94, 0.2)' : undefined 
            }}>
              📊 Rapport de tri
            </Link>
          )}
          <Link to="/users" className="ghost-btn" style={{
            background: location.pathname === '/users' ? 'rgba(124, 58, 237, 0.2)' : undefined
          }}>
            {usersLinkText}
          </Link>
        </div>
      </header>
      <main className="page">{children}</main>
    </div>
  )
}
