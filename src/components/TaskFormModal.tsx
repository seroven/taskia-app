import { useState, type FormEvent } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { errorMessage } from '../lib/errors'
import type { Course } from '../types'
import { todayISO } from '../types'
import { DateField } from './ui/DateField'
import { TextAreaField, TextField } from './ui/Field'
import { SelectField } from './ui/SelectField'

interface Props {
  open: boolean
  courses: Course[]
  onClose: () => void
  onCreate: (input: {
    title: string
    description?: string
    course_id: number
    due_date: string
  }) => Promise<void>
}

export function TaskFormModal({ open, courses, onClose, onCreate }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [courseId, setCourseId] = useState('')
  const [dueDate, setDueDate] = useState(todayISO())
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const courseOptions = courses.map((course) => ({
    value: String(course.id),
    label: course.name,
  }))

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
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
      await onCreate({
        title,
        description: description.trim() || undefined,
        course_id: Number(courseId),
        due_date: dueDate,
      })
      setTitle('')
      setDescription('')
      setCourseId('')
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
            <h2>Nueva tarea</h2>
            <p className="lede">Se creará en Pendiente.</p>

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

            <DateField
              label="Fecha para realizarla"
              value={dueDate}
              required
              onChange={setDueDate}
            />

            {error && <p className="form-error">{error}</p>}

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
