import { motion } from 'framer-motion'
import { useTheme } from '../theme'

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <motion.button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      title={isDark ? 'Modo claro' : 'Modo oscuro'}
      whileTap={{ scale: 0.92 }}
      whileHover={{ scale: 1.05 }}
    >
      <span className="theme-toggle-icon" aria-hidden>
        {isDark ? '☀️' : '🌙'}
      </span>
      <span className="theme-toggle-label">
        {isDark ? 'Claro' : 'Oscuro'}
      </span>
    </motion.button>
  )
}
