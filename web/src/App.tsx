import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Dashboard } from './pages/Dashboard'
import { Users } from './pages/Users'
import { ToursImport } from './pages/ToursImport'
import { Tours } from './pages/Tours'
import { Import } from './pages/Import'
import { ImportUnifie } from './pages/ImportUnifie'
import { ScanReport } from './pages/ScanReport'
import { Login } from './pages/Login'
import { Layout } from './components/Layout'
import { ProtectedRoute } from './components/ProtectedRoute'
import { useAuth } from './contexts/AuthContext'

function App() {
  const { token } = useAuth()

  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route
            path="/login"
            element={token ? <Navigate to="/" replace /> : <Login />}
          />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/users"
            element={
              <ProtectedRoute>
                <Users />
              </ProtectedRoute>
            }
          />
          <Route
            path="/tours-import"
            element={
              <ProtectedRoute>
                <ToursImport />
              </ProtectedRoute>
            }
          />
          <Route
            path="/import-unifie"
            element={
              <ProtectedRoute>
                <ImportUnifie />
              </ProtectedRoute>
            }
          />
          <Route
            path="/tours"
            element={
              <ProtectedRoute>
                <Tours />
              </ProtectedRoute>
            }
          />
          <Route
            path="/import"
            element={
              <ProtectedRoute>
                <Import />
              </ProtectedRoute>
            }
          />
          <Route
            path="/scan-report"
            element={
              <ProtectedRoute>
                <ScanReport />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}

export default App
