import { useEffect, useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { errorMessage } from '../lib/errors'
import {
  STATUS_COLUMNS,
  type Course,
  type Task,
  type TaskStatus,
} from '../types'
import { DateField } from './ui/DateField'
import { TextAreaField, TextField } from './ui/Field'
import { SelectField } from './ui/SelectField'

interface Props {
  task: Task | null
  courses: Course[]
  onClose: () => void
  onSave: (input: {
    task_id: number
    title: string
    description?: string
    course_id: number
    due_date: string
    status: TaskStatus
  }) => Promise<void>
}

export function TaskDetailModal({ task, courses, onClose, onSave }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [courseId, setCourseId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [status, setStatus] = useState<TaskStatus>('pending')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!task) return
    setTitle(task.title)
    setDescription(task.description ?? '')
    setCourseId(String(task.course_id))
    setDueDate(task.due_date)
    setStatus(task.status)
    setError(null)
  }, [task])

  const courseOptions = courses.map((course) => ({
    value: String(course.id),
    label: course.name,
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
    if (!dueDate) {
      setError('Elige una fecha')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      await onSave({
        task_id: task.id,
        title,
        description: description.trim() || undefined,
        course_id: Number(courseId),
        due_date: dueDate,
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
            <h2>Detalle de la tarea</h2>
            <p className="lede">
              Creada el {task.created_at.slice(0, 10)}. Puedes editarla aquí.
            </p>

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
              label="Estado"
              value={status}
              options={statusOptions}
              required
              onChange={(value) => setStatus(value as TaskStatus)}
            />

            <DateField
              label="Fecha para realizarla"
              value={dueDate}
              required
              onChange={setDueDate}
            />

            {error && <p className="form-error">{error}</p>}

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
