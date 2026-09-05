import { AuthProvider, useAuth } from './auth'
import { ThemeProvider } from './theme'
import { AdminPage } from './pages/AdminPage'
import { AuthPage } from './pages/AuthPage'
import { BoardPage } from './pages/BoardPage'

function AppRouter() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="boot-screen">
        <p className="brand">Taskia</p>
        <p className="muted">Cargando…</p>
      </div>
    )
  }

  if (!user) return <AuthPage />
  if (user.role === 'admin') return <AdminPage />
  return <BoardPage />
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </ThemeProvider>
  )
}
