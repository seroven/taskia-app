import { motion } from 'framer-motion'

export function BoardLoader({ label = 'Filtrando tareas…' }: { label?: string }) {
  return (
    <motion.div
      className="board-loader"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      role="status"
      aria-live="polite"
    >
      <div className="board-loader-card">
        <span className="board-spinner" aria-hidden />
        <p>{label}</p>
      </div>
    </motion.div>
  )
}
