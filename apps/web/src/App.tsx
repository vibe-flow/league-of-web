import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { DEMO_MODE } from './demo'
import { useDemo } from './demo/DemoProvider'
import { useIsAuthenticated, useAuthLoading, useAuthStore } from './stores/auth.store'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import DashboardPage from './pages/DashboardPage'
import GamePage from './pages/GamePage'
import LobbyPage from './pages/LobbyPage'
import MatchPage from './pages/MatchPage'

// ============================================================================
// ROUTES PROTÉGÉES - MODE NORMAL (avec Zustand)
// ============================================================================

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  // Auth disabled for development — allow all routes
  return <>{children}</>
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useIsAuthenticated()
  const isLoading = useAuthLoading()

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-gray-900" />
      </div>
    )
  }

  return isAuthenticated ? <Navigate to="/dashboard" /> : <>{children}</>
}

// ============================================================================
// ROUTES PROTÉGÉES - MODE DÉMO (avec DemoProvider)
// ============================================================================

function DemoProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useDemo()
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />
}

function DemoPublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useDemo()
  return isAuthenticated ? <Navigate to="/dashboard" /> : <>{children}</>
}

// ============================================================================
// APP
// ============================================================================

function App() {
  // DEV: inject a fake user so lobby/match pages work without login
  // Each tab gets a unique ID via sessionStorage (localStorage is shared between tabs)
  const setUser = useAuthStore((s) => s.setUser)
  useEffect(() => {
    let devId = sessionStorage.getItem('dev-player-id')
    if (!devId) {
      devId = 'dev-player-' + Math.random().toString(36).slice(2, 8)
      sessionStorage.setItem('dev-player-id', devId)
    }
    // Always force the user from sessionStorage — overrides localStorage rehydration
    setUser({ id: devId, email: `${devId}@localhost`, name: devId, role: 'USER' })
  }, [setUser])

  // En mode démo, utilise les routes démo
  if (DEMO_MODE) {
    return (
      <Routes>
        <Route
          path="/login"
          element={
            <DemoPublicRoute>
              <LoginPage />
            </DemoPublicRoute>
          }
        />
        <Route
          path="/register"
          element={
            <DemoPublicRoute>
              <RegisterPage />
            </DemoPublicRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <DemoProtectedRoute>
              <DashboardPage />
            </DemoProtectedRoute>
          }
        />
        <Route path="/game" element={<GamePage />} />
        <Route path="/lobby" element={<LobbyPage />} />
        <Route path="/game/:matchId" element={<MatchPage />} />
        <Route path="/" element={<Navigate to="/login" />} />
      </Routes>
    )
  }

  // Mode normal
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        }
      />
      <Route
        path="/register"
        element={
          <PublicRoute>
            <RegisterPage />
          </PublicRoute>
        }
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route path="/game" element={<GamePage />} />
      <Route
        path="/lobby"
        element={
          <ProtectedRoute>
            <LobbyPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/game/:matchId"
        element={
          <ProtectedRoute>
            <MatchPage />
          </ProtectedRoute>
        }
      />
      <Route path="/" element={<Navigate to="/dashboard" />} />
    </Routes>
  )
}

export default App
