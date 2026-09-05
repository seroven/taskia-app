import { useEffect, useState, type FormEvent } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { errorMessage } from '../lib/errors'
import type { Course, Difficulty, TaskKind } from '../types'
import { todayISO } from '../types'
import { DateField } from './ui/DateField'
import { TextAreaField, TextField } from './ui/Field'
import { SelectField } from './ui/SelectField'

interface Props {
  open: boolean
  courses: Course[]
  difficulties: Difficulty[]
  onClose: () => void
  onCreate: (input: {
    title: string
    description?: string
    course_id: number
    difficulty_id: number
    task_kind: TaskKind
    due_date?: string
  }) => Promise<void>
}

export function TaskFormModal({
  open,
  courses,
  difficulties,
  onClose,
  onCreate,
}: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [courseId, setCourseId] = useState('')
  const [difficultyId, setDifficultyId] = useState('')
  const [taskKind, setTaskKind] = useState<TaskKind>('daily')
  const [dueDate, setDueDate] = useState(todayISO())
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    if (!difficultyId && difficulties.length > 0) {
      const medium =
        difficulties.find((item) => item.code === 'medium') ?? difficulties[0]
      setDifficultyId(String(medium.id))
    }
  }, [open, difficulties, difficultyId])

  const courseOptions = courses.map((course) => ({
    value: String(course.id),
    label: course.name,
  }))

  const difficultyOptions = difficulties.map((item) => ({
    value: String(item.id),
    label: item.name,
  }))

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
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
      await onCreate({
        title,
        description: description.trim() || undefined,
        course_id: Number(courseId),
        difficulty_id: Number(difficultyId),
        task_kind: taskKind,
        due_date: taskKind === 'project' ? dueDate : undefined,
      })
      setTitle('')
      setDescription('')
      setCourseId('')
      setDifficultyId('')
      setTaskKind('daily')
      setDueDate(todayISO())
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.form
            className="modal-panel"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.28 }}
            onClick={(e) => e.stopPropagation()}
            onSubmit={onSubmit}
          >
            <div className="modal-panel-header">
              <h2>Nueva tarea</h2>
              <p className="lede">Se creará en Pendiente.</p>
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
                rows={3}
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
                Cancelar
              </button>
              <button type="submit" className="primary" disabled={submitting}>
                {submitting ? 'Guardando…' : 'Crear tarea'}
              </button>
            </div>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
