import { useEffect, useState, type FormEvent } from 'react'
import { errorMessage } from '../../lib/errors'
import {
  STATUS_COLUMNS,
  todayISO,
  type Course,
  type Difficulty,
  type Task,
  type TaskKind,
  type TaskStatus,
} from '../../types'
import { DateField } from '../ui/DateField'
import { TextAreaField, TextField } from '../ui/Field'
import { SelectField } from '../ui/SelectField'

export type TaskEditPayload = {
  task_id: number
  title: string
  description?: string
  course_id: number
  difficulty_id: number
  task_kind: TaskKind
  due_date?: string
  status: TaskStatus
}

interface Props {
  task: Task
  courses: Course[]
  difficulties: Difficulty[]
  onSave: (input: TaskEditPayload) => Promise<Task>
}

export function TaskEditPanel({ task, courses, difficulties, onSave }: Props) {
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description ?? '')
  const [courseId, setCourseId] = useState(String(task.course_id))
  const [difficultyId, setDifficultyId] = useState(String(task.difficulty_id))
  const [taskKind, setTaskKind] = useState<TaskKind>(task.task_kind)
  const [dueDate, setDueDate] = useState(task.due_date)
  const [status, setStatus] = useState<TaskStatus>(task.status)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setTitle(task.title)
    setDescription(task.description ?? '')
    setCourseId(String(task.course_id))
    setDifficultyId(String(task.difficulty_id))
    setTaskKind(task.task_kind)
    setDueDate(task.due_date)
    setStatus(task.status)
    setError(null)
    setSaved(false)
  }, [task])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!courseId || !difficultyId) {
      setError('Completa curso y dificultad')
      return
    }
    if (taskKind === 'project' && !dueDate) {
      setError('Elige hasta cuándo tienes para el proyecto')
      return
    }

    setSubmitting(true)
    setError(null)
    setSaved(false)
    try {
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
      setSaved(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="study-edit-panel" onSubmit={(e) => void onSubmit(e)}>
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
        options={courses.map((c) => ({ value: String(c.id), label: c.name }))}
        placeholder="Selecciona…"
        required
        onChange={setCourseId}
      />
      <SelectField
        label="Dificultad"
        value={difficultyId}
        options={difficulties.map((d) => ({
          value: String(d.id),
          label: d.name,
        }))}
        placeholder="Selecciona…"
        required
        onChange={setDifficultyId}
      />
      <SelectField
        label="Estado"
        value={status}
        options={STATUS_COLUMNS.map((c) => ({ value: c.id, label: c.label }))}
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
      {saved && !error && <p className="study-saved">Cambios guardados</p>}

      <div className="study-edit-actions">
        <button type="submit" className="primary" disabled={submitting}>
          {submitting ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  )
}
