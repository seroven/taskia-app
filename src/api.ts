import { invoke } from '@tauri-apps/api/core'
import type {
  Course,
  Difficulty,
  PublicUser,
  Task,
  TaskFilters,
  TaskKind,
  TaskStatus,
} from './types'

function cleanFilters(filters: TaskFilters) {
  return {
    created_on: filters.created_on || null,
    due_on: filters.due_on || null,
    course_id: filters.course_id ?? null,
    status: filters.status || null,
  }
}

export const api = {
  register(username: string, email: string, password: string) {
    return invoke<PublicUser>('register', {
      payload: { username, email, password },
    })
  },
  login(username: string, password: string) {
    return invoke<PublicUser>('login', {
      payload: { username, password },
    })
  },
  logout() {
    return invoke<void>('logout')
  },
  currentUser() {
    return invoke<PublicUser | null>('current_user')
  },
  listCourses() {
    return invoke<Course[]>('list_courses')
  },
  listDifficulties() {
    return invoke<Difficulty[]>('list_difficulties')
  },
  listTasks(filters: TaskFilters) {
    return invoke<Task[]>('list_tasks', { filters: cleanFilters(filters) })
  },
  createTask(input: {
    title: string
    description?: string
    course_id: number
    difficulty_id: number
    task_kind: TaskKind
    due_date?: string
  }) {
    return invoke<Task>('create_task', { payload: input })
  },
  updateTask(input: {
    task_id: number
    title: string
    description?: string
    course_id: number
    difficulty_id: number
    task_kind: TaskKind
    due_date?: string
    status: TaskStatus
  }) {
    return invoke<Task>('update_task', { payload: input })
  },
  moveTask(task_id: number, status: TaskStatus, board_order: number) {
    return invoke<Task>('move_task', {
      payload: { task_id, status, board_order },
    })
  },
  reorderTasks(
    items: { task_id: number; status: TaskStatus; board_order: number }[],
  ) {
    return invoke<void>('reorder_tasks', { items })
  },
  studyLoadSession(task_id: number) {
    return invoke<import('./lib/studyProtocol').StudySession>('study_load_session', {
      taskId: task_id,
    })
  },
  studySaveBoard(task_id: number, board: import('./lib/studyProtocol').StudyBoardScene) {
    return invoke<void>('study_save_board', {
      taskId: task_id,
      board,
    })
  },
  studyChat(
    task_id: number,
    user_message: string,
    board?: { description?: string; image_base64?: string | null },
    allowAiDraw = false,
  ) {
    return invoke<import('./lib/studyProtocol').StudyChatResponse>('study_chat', {
      taskId: task_id,
      userMessage: user_message,
      boardDescription: board?.description ?? null,
      boardImageBase64: board?.image_base64 ?? null,
      allowAiDraw,
    })
  },
}
