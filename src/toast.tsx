import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { AnimatePresence, motion } from 'framer-motion'

export type ToastTone = 'success' | 'warning' | 'error'

export interface ShowToastInput {
  title: string
  subtitle: string
  tone?: ToastTone
}

interface ToastItem extends ShowToastInput {
  id: number
  tone: ToastTone
}

interface ToastContextValue {
  showToast: (input: ShowToastInput) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let toastSeq = 0

function ToastIcon({ tone }: { tone: ToastTone }) {
  if (tone === 'success') {
    return (
      <span className="toast-icon" aria-hidden>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
          <path
            d="M6.5 12.5 10.2 16 17.5 8.5"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    )
  }
  if (tone === 'warning') {
    return (
      <span className="toast-icon" aria-hidden>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
          <path
            d="M12 5.2 19.2 18H4.8L12 5.2Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path d="M12 10.2v3.8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="12" cy="16.4" r="1.05" fill="currentColor" />
        </svg>
      </span>
    )
  }
  return (
    <span className="toast-icon" aria-hidden>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
        <path d="M12 7.2v6.2" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="12" cy="16.6" r="1.2" fill="currentColor" />
      </svg>
    </span>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const showToast = useCallback(
    (input: ShowToastInput) => {
      const title = input.title.trim()
      const subtitle = input.subtitle.trim()
      if (!title || !subtitle) return
      const tone = input.tone ?? 'warning'
      const id = ++toastSeq
      setToasts((prev) => [...prev.slice(-2), { id, title, subtitle, tone }])
      window.setTimeout(() => dismiss(id), 5200)
    },
    [dismiss],
  )

  const value = useMemo(() => ({ showToast }), [showToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-viewport" aria-live="polite" aria-relevant="additions">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              className={`app-toast app-toast-${toast.tone}`}
              role="status"
              initial={{ opacity: 0, y: -14, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              <ToastIcon tone={toast.tone} />
              <div className="toast-copy">
                <strong className="toast-title">{toast.title}</strong>
                <p className="toast-subtitle">{toast.subtitle}</p>
              </div>
              <button
                type="button"
                className="toast-close"
                aria-label="Cerrar"
                onClick={() => dismiss(toast.id)}
              >
                ×
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast debe usarse dentro de ToastProvider')
  }
  return ctx
}
