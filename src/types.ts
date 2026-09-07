export type UserRole = 'user' | 'admin'

export type TaskStatus = 'pending' | 'in_progress' | 'studying' | 'done'

export type TaskKind = 'daily' | 'project'

export interface PublicUser {
  id: number
  username: string
  email: string
  role: UserRole
}

export interface Course {
  id: number
  name: string
}

export interface Difficulty {
  id: number
  code: string
  name: string
  sort_order: number
}

export interface Task {
  id: number
  user_id: number
  course_id: number
  course_name: string
  difficulty_id: number
  difficulty_code: string
  difficulty_name: string
  title: string
  description: string | null
  task_kind: TaskKind
  status: TaskStatus
  board_order: number
  /** True si la IA confirmó que el niño dominó la tarea (candado Alta). */
  study_passed: boolean
  due_date: string
  created_at: string
  updated_at: string
}

export interface TaskFilters {
  created_on?: string | null
  due_on?: string | null
  course_id?: number | null
  status?: TaskStatus | null
}

export const STATUS_COLUMNS: { id: TaskStatus; label: string }[] = [
  { id: 'pending', label: 'Pendiente' },
  { id: 'in_progress', label: 'En proceso' },
  { id: 'studying', label: 'En estudio' },
  { id: 'done', label: 'Terminado' },
]

/** Candado de dificultad Alta → Terminado. */
export const STUDY_PASSED_REQUIRED_TITLE = 'Aún no puedes terminar'
export const STUDY_PASSED_REQUIRED_MSG =
  'Estudia con el tutor hasta que diga que estás listo.'

export function todayISO(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
