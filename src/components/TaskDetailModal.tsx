import { useEffect, useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { errorMessage } from '../lib/errors'
import { useToast } from '../toast'
import {
  STATUS_COLUMNS,
  STUDY_PASSED_REQUIRED_MSG,
  STUDY_PASSED_REQUIRED_TITLE,
  todayISO,
  type Course,
  type Difficulty,
  type Task,
  type TaskKind,
  type TaskStatus,
} from '../types'
import { DateField } from './ui/DateField'
import { TextAreaField, TextField } from './ui/Field'
import { SelectField } from './ui/SelectField'

interface Props {
  task: Task | null
  courses: Course[]
  difficulties: Difficulty[]
  onClose: () => void
  onSave: (input: {
    task_id: number
    title: string
    description?: string
    course_id: number
    difficulty_id: number
    task_kind: TaskKind
    due_date?: string
    status: TaskStatus
  }) => Promise<void>
}

export function TaskDetailModal({
  task,
  courses,
  difficulties,
  onClose,
  onSave,
}: Props) {
  const { showToast } = useToast()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [courseId, setCourseId] = useState('')
  const [difficultyId, setDifficultyId] = useState('')
  const [taskKind, setTaskKind] = useState<TaskKind>('daily')
  const [dueDate, setDueDate] = useState('')
  const [status, setStatus] = useState<TaskStatus>('pending')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!task) return
    setTitle(task.title)
    setDescription(task.description ?? '')
    setCourseId(String(task.course_id))
    setDifficultyId(String(task.difficulty_id))
    setTaskKind(task.task_kind)
    setDueDate(task.due_date)
    setStatus(task.status)
    setError(null)
  }, [task])

  const courseOptions = courses.map((course) => ({
    value: String(course.id),
    label: course.name,
  }))

  const difficultyOptions = difficulties.map((item) => ({
    value: String(item.id),
    label: item.name,
  }))

  const statusOptions = STATUS_COLUMNS.map((column) => ({
    value: column.id,
    label: column.label,
  }))

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!task) return
    if (!courseId) {
      setError('Selecciona un curso')
      return
    }
    if (!difficultyId) {
      setError('Selecciona una dificultad')
      return
    }
    if (taskKind === 'project' && !dueDate) {
      setError('Elige hasta cuándo tienes para el proyecto')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const nextDifficulty =
        difficulties.find((item) => item.id === Number(difficultyId))?.code ??
        task.difficulty_code
      if (
        status === 'done' &&
        task.status !== 'done' &&
        nextDifficulty === 'high' &&
        !task.study_passed
      ) {
        showToast({
          title: STUDY_PASSED_REQUIRED_TITLE,
          subtitle: STUDY_PASSED_REQUIRED_MSG,
          tone: 'warning',
        })
        setError(STUDY_PASSED_REQUIRED_MSG)
        setSubmitting(false)
        return
      }
      await onSave({
        task_id: task.id,
        title,
        description: description.trim() || undefined,
        course_id: Number(courseId),
        difficulty_id: Number(difficultyId),
        task_kind: taskKind,
        due_date: taskKind === 'project' ? dueDate : undefined,
        status,
      })
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AnimatePresence>
      {task && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.form
            className="modal-panel task-detail-panel"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.28 }}
            onClick={(e) => e.stopPropagation()}
            onSubmit={onSubmit}
          >
            <div className="modal-panel-header">
              <h2>Detalle de la tarea</h2>
              <p className="lede">
                Creada el {task.created_at.slice(0, 10)}. Puedes editarla aquí.
              </p>
            </div>

            <div className="modal-panel-body">
              <div className="kind-toggle" role="group" aria-label="Tipo de tarea">
                <button
                  type="button"
                  className={taskKind === 'daily' ? 'active' : ''}
                  onClick={() => {
                    setTaskKind('daily')
                    setDueDate(todayISO())
                  }}
                >
                  Tarea del día
                </button>
                <button
                  type="button"
                  className={taskKind === 'project' ? 'active' : ''}
                  onClick={() => setTaskKind('project')}
                >
                  Proyecto
                </button>
              </div>

              <TextField
                label="Título"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />

              <TextAreaField
                label="Descripción"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
              />

              <SelectField
                label="Curso"
                value={courseId}
                options={courseOptions}
                placeholder="Selecciona…"
                required
                onChange={setCourseId}
              />

              <SelectField
                label="Dificultad"
                value={difficultyId}
                options={difficultyOptions}
                placeholder="Selecciona…"
                required
                onChange={setDifficultyId}
              />

              <SelectField
                label="Estado"
                value={status}
                options={statusOptions}
                required
                onChange={(value) => setStatus(value as TaskStatus)}
              />

              {taskKind === 'daily' ? (
                <p className="kind-hint">
                  Fecha de término: <strong>hoy ({todayISO()})</strong>
                </p>
              ) : (
                <DateField
                  label="Hasta cuándo tienes para hacerlo"
                  value={dueDate}
                  required
                  onChange={setDueDate}
                />
              )}

              {error && <p className="form-error">{error}</p>}
            </div>

            <div className="modal-actions">
              <button type="button" className="ghost" onClick={onClose}>
                Cerrar
              </button>
              <button type="submit" className="primary" disabled={submitting}>
                {submitting ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
