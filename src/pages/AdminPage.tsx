import { useAuth } from '../auth'
import { ThemeToggle } from '../components/ThemeToggle'

export function AdminPage() {
  const { user, logout } = useAuth()

  return (
    <div className="admin-shell">
      <header className="topbar">
        <p className="brand">Taskia</p>
        <div className="topbar-actions">
          <ThemeToggle />
          <span className="user-chip">{user?.username} · admin</span>
          <button type="button" className="ghost" onClick={() => void logout()}>
            Salir
          </button>
        </div>
      </header>
      <main className="admin-main">
        <h1>Panel de administrador</h1>
        <p>
          Esta vista la definiremos después. Por ahora el acceso admin ya
          funciona.
        </p>
      </main>
    </div>
  )
}
