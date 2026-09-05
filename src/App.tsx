import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AuthProvider, useAuth } from './auth'
import { ThemeProvider } from './theme'
import { AdminPage } from './pages/AdminPage'
import { AuthPage } from './pages/AuthPage'
import { BoardPage } from './pages/BoardPage'
import { StudyPage } from './pages/StudyPage'
import type { Task } from './types'

const viewTransition = {
  initial: { opacity: 0, y: 14, scale: 0.985 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -10, scale: 0.99 },
  transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const },
}

function AppRouter() {
  const { user, loading } = useAuth()
  const [view, setView] = useState<'board' | 'study'>('board')
  const [studyTaskId, setStudyTaskId] = useState<number | null>(null)

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

  return (
    <div className="app-view-root">
      <AnimatePresence mode="wait">
        {view === 'study' && studyTaskId != null ? (
          <motion.div
            key={`study-${studyTaskId}`}
            className="app-view-panel"
            initial={viewTransition.initial}
            animate={viewTransition.animate}
            exit={viewTransition.exit}
            transition={viewTransition.transition}
          >
            <StudyPage
              taskId={studyTaskId}
              onBack={() => {
                setView('board')
                setStudyTaskId(null)
              }}
            />
          </motion.div>
        ) : (
          <motion.div
            key="board"
            className="app-view-panel"
            initial={viewTransition.initial}
            animate={viewTransition.animate}
            exit={viewTransition.exit}
            transition={viewTransition.transition}
          >
            <BoardPage
              onOpenStudy={(task: Task) => {
                setStudyTaskId(task.id)
                setView('study')
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
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
