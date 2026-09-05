import { useState, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../auth'
import { ThemeToggle } from '../components/ThemeToggle'
import { TextField } from '../components/ui/Field'
import { errorMessage } from '../lib/errors'

type Mode = 'login' | 'register'

export function AuthPage() {
  const { login, register } = useAuth()
  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      if (mode === 'login') {
        await login(username, password)
      } else {
        await register(username, email, password)
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-theme-slot">
        <ThemeToggle />
      </div>
      <motion.div
        className="auth-panel"
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        <p className="brand">Taskia</p>
        <h1>{mode === 'login' ? '¡Hola de nuevo!' : '¡Vamos a empezar!'}</h1>
        <p className="lede">
          Arma tus tareas del día y muévelas por el tablero como un juego.
        </p>

        <div className="mode-switch" role="tablist">
          <button
            type="button"
            className={mode === 'login' ? 'active' : ''}
            onClick={() => {
              setMode('login')
              setError(null)
            }}
          >
            Entrar
          </button>
          <button
            type="button"
            className={mode === 'register' ? 'active' : ''}
            onClick={() => {
              setMode('register')
              setError(null)
            }}
          >
            Crear cuenta
          </button>
        </div>

        <form onSubmit={onSubmit} className="auth-form">
          <TextField
            label="Usuario"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
            minLength={3}
          />

          {mode === 'register' && (
            <TextField
              label="Correo"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          )}

          <TextField
            label="Contraseña"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={
              mode === 'login' ? 'current-password' : 'new-password'
            }
            required
            minLength={6}
          />

          {error && <p className="form-error">{error}</p>}

          <button type="submit" className="primary" disabled={submitting}>
            {submitting
              ? 'Un momento…'
              : mode === 'login'
                ? '¡Entrar!'
                : '¡Crear y entrar!'}
          </button>
        </form>
      </motion.div>
    </div>
  )
}
