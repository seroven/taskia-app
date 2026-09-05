export type UserRole = 'user' | 'admin'

export type TaskStatus = 'pending' | 'in_progress' | 'studying' | 'done'

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

export interface Task {
  id: number
  user_id: number
  course_id: number
  course_name: string
  title: string
  description: string | null
  status: TaskStatus
  board_order: number
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

export function todayISO(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
