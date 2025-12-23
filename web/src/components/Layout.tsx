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

  const isActive = (path: string) => location.pathname === path

  return (
    <div className="app-shell">
      <header className="nav" style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        padding: '0 20px',
        gap: 20
      }}>
        {/* GAUCHE: Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="brand">Trizee</span>
          <span className="pill">Web</span>
        </div>

        {/* CENTRE: Navigation */}
        {!isLogin && token && (
          <nav style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Link 
              to="/" 
              className="ghost-btn"
              style={{ 
                background: isActive('/') ? 'rgba(124, 58, 237, 0.2)' : undefined,
                borderRadius: 8
              }}
            >
              Tableau de bord
            </Link>
            
            <Link 
              to="/import-unifie" 
              className="ghost-btn"
              style={{ 
                background: isActive('/import-unifie') ? 'rgba(34, 197, 94, 0.2)' : undefined,
                borderRadius: 8,
                color: '#4ade80'
              }}
            >
              🚀 Import & Tournées
            </Link>

            {user?.role === 'ADMIN' && (
              <Link 
                to="/scan-report" 
                className="ghost-btn"
                style={{ 
                  background: isActive('/scan-report') ? 'rgba(251, 146, 60, 0.2)' : undefined,
                  borderRadius: 8
                }}
              >
                📊 Rapport de tri
              </Link>
            )}

            <Link 
              to="/users" 
              className="ghost-btn"
              style={{ 
                background: isActive('/users') ? 'rgba(124, 58, 237, 0.2)' : undefined,
                borderRadius: 8
              }}
            >
              {user?.role === 'DISPATCHER' ? '👤 Mon profil' : 'Utilisateurs'}
            </Link>
          </nav>
        )}

        {/* DROITE: User info + Déconnexion */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {!isLogin && token && (
            <>
              <span className="pill" style={{ 
                background: 'rgba(124, 58, 237, 0.15)',
                color: '#a78bfa',
                padding: '6px 12px',
                borderRadius: 20,
                fontSize: 13,
                fontWeight: 500
              }}>
                {user?.login} - {user?.role}
              </span>
              <button 
                className="ghost-btn" 
                onClick={logout} 
                style={{ 
                  color: '#f87171',
                  background: 'rgba(248, 113, 113, 0.1)',
                  borderRadius: 8,
                  padding: '8px 16px',
                  fontSize: 13
                }}
              >
                Déconnexion
              </button>
            </>
          )}
          {!isLogin && !token && (
            <button 
              className="ghost-btn" 
              onClick={() => navigate('/login')}
              style={{
                background: 'rgba(34, 197, 94, 0.15)',
                color: '#4ade80',
                borderRadius: 8,
                padding: '8px 16px'
              }}
            >
              Connexion
            </button>
          )}
        </div>
      </header>
      <main className="page">{children}</main>
    </div>
  )
}
