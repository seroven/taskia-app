import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../api'
import { ExcalidrawBoard, type ExcalidrawBoardHandle } from '../components/study/ExcalidrawBoard'
import { StudyChat } from '../components/study/StudyChat'
import { TaskEditPanel } from '../components/study/TaskEditPanel'
import { errorMessage } from '../lib/errors'
import {
  parseDrawOps,
  type StudyBoardScene,
  type StudyContext,
  type StudyExercise,
  type TutorPhase,
} from '../lib/studyProtocol'
import { useTheme } from '../theme'
import type { Course, Difficulty, Task } from '../types'

interface Props {
  taskId: number
  onBack: () => void
}

export function StudyPage({ taskId, onBack }: Props) {
  const { theme } = useTheme()
  const [mode, setMode] = useState<'study' | 'edit'>('study')
  const [task, setTask] = useState<Task | null>(null)
  const [context, setContext] = useState<StudyContext | null>(null)
  const [board, setBoard] = useState<StudyBoardScene | null>(null)
  const [boardReady, setBoardReady] = useState(false)
  const [courses, setCourses] = useState<Course[]>([])
  const [difficulties, setDifficulties] = useState<Difficulty[]>([])
  const [phase, setPhase] = useState<TutorPhase | string>('understanding')
  const [exercise, setExercise] = useState<StudyExercise | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chatError, setChatError] = useState<string | null>(null)
  const boardRef = useRef<ExcalidrawBoardHandle>(null)
  const saveBoardRef = useRef<(scene: StudyBoardScene) => void>(() => {})

  useEffect(() => {
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const [session, nextCourses, nextDifficulties] = await Promise.all([
          api.studyLoadSession(taskId),
          api.listCourses(),
          api.listDifficulties(),
        ])
        setTask(session.task)
        setContext(session.context)
        setBoard(session.board)
        setPhase(session.context.tutor_phase)
        setCourses(nextCourses)
        setDifficulties(nextDifficulties)
        setBoardReady(true)
      } catch (err) {
        setError(errorMessage(err))
      } finally {
        setLoading(false)
      }
    })()
  }, [taskId])

  const persistBoard = useCallback(
    (scene: StudyBoardScene) => {
      void api.studySaveBoard(taskId, scene).catch((err) => {
        setChatError(errorMessage(err))
      })
    },
    [taskId],
  )

  useEffect(() => {
    saveBoardRef.current = persistBoard
  }, [persistBoard])

  const onBoardSave = useCallback((scene: StudyBoardScene) => {
    saveBoardRef.current(scene)
  }, [])

  async function onSend(
    message: string,
    options: { includeBoard: boolean; allowAiDraw: boolean },
  ) {
    setSending(true)
    setChatError(null)
    try {
      let board:
        | { description?: string; image_base64?: string | null }
        | undefined
      if (options.includeBoard) {
        const attachment = await boardRef.current?.getBoardAttachment()
        if ((attachment?.elementCount ?? 0) > 0) {
          board = {
            description: attachment?.description,
            image_base64: attachment?.imageBase64 ?? null,
          }
        }
      }
      const result = await api.studyChat(
        taskId,
        message,
        board,
        options.allowAiDraw,
      )
      setContext(result.context)
      setPhase(result.reply.phase)
      setExercise(result.reply.exercise)
      const ops = parseDrawOps(result.reply.draw_ops)
      if (ops.length > 0) {
        boardRef.current?.applyDrawOps(ops)
      }
    } catch (err) {
      setChatError(errorMessage(err))
      throw err
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return (
      <div className="study-page">
        <div className="boot-screen study-boot">
          <p className="brand">Modo estudio</p>
          <p className="muted">Preparando la sesión…</p>
        </div>
      </div>
    )
  }

  if (error || !task) {
    return (
      <div className="study-page">
        <header className="study-header">
          <button type="button" className="ghost" onClick={onBack}>
            ← Volver
          </button>
        </header>
        <p className="form-error banner">{error ?? 'No se pudo abrir la sesión'}</p>
      </div>
    )
  }

  return (
    <div className="study-page">
      <header className="study-header">
        <button type="button" className="ghost" onClick={onBack}>
          ← Tablero
        </button>
        <div className="study-header-main">
          <h1>{task.title}</h1>
          <div className="study-header-tags">
            <span className="course-tag">{task.course_name}</span>
            <span className={`difficulty-tag difficulty-${task.difficulty_code}`}>
              {task.difficulty_name}
            </span>
          </div>
        </div>
        <div className="study-mode-toggle" role="group" aria-label="Modo">
          <button
            type="button"
            className={mode === 'study' ? 'active' : ''}
            onClick={() => setMode('study')}
          >
            Estudiar
          </button>
          <button
            type="button"
            className={mode === 'edit' ? 'active' : ''}
            onClick={() => setMode('edit')}
          >
            Editar
          </button>
        </div>
      </header>

      <AnimatePresence mode="wait">
        {mode === 'edit' ? (
          <motion.div
            key="edit"
            className="study-edit-layout"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.99 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            <TaskEditPanel
              task={task}
              courses={courses}
              difficulties={difficulties}
              onSave={async (input) => {
                const updated = await api.updateTask(input)
                setTask(updated)
                if (updated.status !== 'studying') {
                  onBack()
                }
                return updated
              }}
            />
          </motion.div>
        ) : (
          <motion.div
            key="study"
            className="study-layout"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.99 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            <StudyChat
              context={context}
              phase={phase}
              exercise={exercise}
              sending={sending}
              error={chatError}
              onSend={onSend}
            />
            <div className="study-board-pane">
              {boardReady && (
                <ExcalidrawBoard
                  key={`board-${task.id}-${theme}`}
                  ref={boardRef}
                  initialBoard={board}
                  onSave={onBoardSave}
                  theme={theme}
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
