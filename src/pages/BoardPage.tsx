import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  defaultDropAnimationSideEffects,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type {
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  DropAnimation,
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../api'
import { useAuth } from '../auth'
import { BoardFilters } from '../components/BoardFilters'
import { BoardLoader } from '../components/BoardLoader'
import { KanbanColumn } from '../components/KanbanColumn'
import { TaskCardView } from '../components/TaskCard'
import { TaskDetailModal } from '../components/TaskDetailModal'
import { TaskFormModal } from '../components/TaskFormModal'
import { ThemeToggle } from '../components/ThemeToggle'
import {
  STATUS_COLUMNS,
  STUDY_PASSED_REQUIRED_MSG,
  STUDY_PASSED_REQUIRED_TITLE,
  todayISO,
  type Course,
  type Difficulty,
  type Task,
  type TaskFilters,
  type TaskStatus,
} from '../types'
import { errorMessage } from '../lib/errors'
import { useToast } from '../toast'

function isStatus(value: string | number): value is TaskStatus {
  return STATUS_COLUMNS.some((column) => column.id === value)
}

function needsStudyPassedGate(task: Task, nextStatus: TaskStatus): boolean {
  return (
    nextStatus === 'done' &&
    task.status !== 'done' &&
    task.difficulty_code === 'high' &&
    !task.study_passed
  )
}

const dropAnimation: DropAnimation = {
  duration: 220,
  easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: {
        opacity: '0.35',
      },
    },
  }),
}

export function BoardPage({
  onOpenStudy,
}: {
  onOpenStudy: (task: Task) => void
}) {
  const { user, logout } = useAuth()
  const { showToast } = useToast()
  const [courses, setCourses] = useState<Course[]>([])
  const [difficulties, setDifficulties] = useState<Difficulty[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [overStatus, setOverStatus] = useState<TaskStatus | null>(null)
  const [filters, setFilters] = useState<TaskFilters>({
    created_on: todayISO(),
    due_on: null,
    course_id: null,
    status: null,
  })
  const [loading, setLoading] = useState(true)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [boardVersion, setBoardVersion] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const requestId = useRef(0)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )

  const loadTasks = useCallback(async (nextFilters: TaskFilters) => {
    const currentRequest = ++requestId.current
    setLoading(true)
    setError(null)

    try {
      const rows = await api.listTasks(nextFilters)
      if (currentRequest !== requestId.current) return
      setTasks(rows)
      setBoardVersion((value) => value + 1)
      setHasLoadedOnce(true)
    } catch (err) {
      if (currentRequest !== requestId.current) return
      setError(errorMessage(err))
    } finally {
      if (currentRequest === requestId.current) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const [nextCourses, nextDifficulties] = await Promise.all([
          api.listCourses(),
          api.listDifficulties(),
        ])
        setCourses(nextCourses)
        setDifficulties(nextDifficulties)
      } catch (err) {
        setError(errorMessage(err))
      }
    })()
  }, [])

  useEffect(() => {
    // Espera a que cierre el popover antes de filtrar, evita pelea con el layout/scroll
    const timer = window.setTimeout(() => {
      void loadTasks(filters)
    }, 120)
    return () => window.clearTimeout(timer)
  }, [filters, loadTasks])

  const grouped = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = {
      pending: [],
      in_progress: [],
      studying: [],
      done: [],
    }
    for (const task of tasks) {
      map[task.status].push(task)
    }
    for (const status of Object.keys(map) as TaskStatus[]) {
      map[status].sort((a, b) => a.board_order - b.board_order || a.id - b.id)
    }
    return map
  }, [tasks])

  async function persistBoard(nextTasks: Task[]) {
    setTasks(nextTasks)
    const items = nextTasks.map((task) => {
      const sameColumn = nextTasks.filter((item) => item.status === task.status)
      const board_order = sameColumn.findIndex((item) => item.id === task.id)
      return {
        task_id: task.id,
        status: task.status,
        board_order,
      }
    })

    const unique = new Map<number, (typeof items)[number]>()
    for (const item of items) unique.set(item.task_id, item)

    try {
      await api.reorderTasks([...unique.values()])
    } catch (err) {
      const message = errorMessage(err)
      setError(message)
      if (message.includes('dificultad Alta')) {
        showToast({
          title: STUDY_PASSED_REQUIRED_TITLE,
          subtitle: STUDY_PASSED_REQUIRED_MSG,
          tone: 'warning',
        })
      }
      await loadTasks(filters)
    }
  }

  function findContainer(id: string | number): TaskStatus | null {
    if (isStatus(id)) return id
    const task = tasks.find((item) => item.id === id)
    return task?.status ?? null
  }

  function onDragStart(event: DragStartEvent) {
    if (loading) return
    const task = tasks.find((item) => item.id === event.active.id) ?? null
    setActiveTask(task)
    setOverStatus(task?.status ?? null)
  }

  function onDragOver(event: DragOverEvent) {
    if (loading) return
    const { active, over } = event
    if (!over) {
      setOverStatus(null)
      return
    }

    const activeId = active.id
    const overId = over.id
    const activeContainer = findContainer(activeId)
    const overContainer = findContainer(overId)
    setOverStatus(overContainer)

    if (!activeContainer || !overContainer || activeContainer === overContainer) {
      return
    }

    setTasks((prev) => {
      const activeTaskItem = prev.find((task) => task.id === activeId)
      if (!activeTaskItem) return prev

      const without = prev.filter((task) => task.id !== activeId)
      const overIndex = without.findIndex((task) => task.id === overId)

      const moved: Task = { ...activeTaskItem, status: overContainer }
      if (overIndex === -1) {
        return [...without, moved]
      }
      const next = [...without]
      next.splice(overIndex, 0, moved)
      return next
    })
  }

  async function onDragEnd(event: DragEndEvent) {
    setActiveTask(null)
    setOverStatus(null)
    if (loading) return
    const { active, over } = event
    if (!over) return

    const activeId = Number(active.id)
    const overId = over.id
    const activeContainer = findContainer(activeId)
    const overContainer = findContainer(overId)
    if (!activeContainer || !overContainer) return

    let next = [...tasks]
    const oldIndex = next.findIndex((task) => task.id === activeId)
    if (oldIndex < 0) return

    if (activeContainer === overContainer) {
      const columnTasks = next.filter((task) => task.status === activeContainer)
      const from = columnTasks.findIndex((task) => task.id === activeId)
      const to = isStatus(overId)
        ? columnTasks.length - 1
        : columnTasks.findIndex((task) => task.id === overId)

      if (from < 0 || to < 0 || from === to) {
        await persistBoard(next)
        return
      }

      const reordered = arrayMove(columnTasks, from, to)
      const others = next.filter((task) => task.status !== activeContainer)
      next = [
        ...others,
        ...reordered.map((task, board_order) => ({ ...task, board_order })),
      ]
    } else {
      next = next.map((task) =>
        task.id === activeId ? { ...task, status: overContainer } : task,
      )
      const columnTasks = next
        .filter((task) => task.status === overContainer)
        .sort((a, b) => {
          if (a.id === activeId) return -1
          if (b.id === activeId) return 1
          return a.board_order - b.board_order
        })

      if (!isStatus(overId)) {
        const overIndex = columnTasks.findIndex((task) => task.id === overId)
        const activeIndex = columnTasks.findIndex((task) => task.id === activeId)
        if (overIndex >= 0 && activeIndex >= 0) {
          const reordered = arrayMove(columnTasks, activeIndex, overIndex)
          const others = next.filter((task) => task.status !== overContainer)
          next = [
            ...others,
            ...reordered.map((task, board_order) => ({ ...task, board_order })),
          ]
        }
      }
    }

    const moved = next.find((task) => task.id === activeId)
    if (
      moved &&
      overContainer === 'done' &&
      activeContainer !== 'done' &&
      needsStudyPassedGate(
        { ...moved, status: activeContainer },
        'done',
      )
    ) {
      showToast({
        title: STUDY_PASSED_REQUIRED_TITLE,
        subtitle: STUDY_PASSED_REQUIRED_MSG,
        tone: 'warning',
      })
      setError(STUDY_PASSED_REQUIRED_MSG)
      await loadTasks(filters)
      return
    }

    await persistBoard(next)
  }

  function onDragCancel() {
    setActiveTask(null)
    setOverStatus(null)
  }

  const loaderLabel = hasLoadedOnce ? 'Filtrando tareas…' : 'Cargando tablero…'

  return (
    <div className="board-shell">
      <header className="topbar">
        <div>
          <p className="brand">Taskia</p>
          <p className="welcome">¡Hola, {user?.username}! 👋</p>
        </div>
        <div className="topbar-actions">
          <ThemeToggle />
          <button
            type="button"
            className="primary"
            onClick={() => setModalOpen(true)}
            disabled={loading}
          >
            Nueva tarea
          </button>
          <button type="button" className="ghost" onClick={() => void logout()}>
            Salir
          </button>
        </div>
      </header>

      <BoardFilters
        filters={filters}
        courses={courses}
        onChange={setFilters}
      />

      {error && <p className="form-error banner">{error}</p>}

      <div className={`kanban-stage${loading ? ' is-loading' : ''}`}>
        <AnimatePresence>{loading && <BoardLoader label={loaderLabel} />}</AnimatePresence>

        <motion.div
          key={boardVersion}
          className="kanban"
          initial={hasLoadedOnce ? { opacity: 0, y: 12 } : { opacity: 0, y: 10 }}
          animate={{ opacity: loading ? 0.35 : 1, y: 0 }}
          transition={{ duration: 0.28 }}
        >
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={(event) => void onDragEnd(event)}
            onDragCancel={onDragCancel}
          >
            {STATUS_COLUMNS.map((column) => (
              <KanbanColumn
                key={column.id}
                status={column.id}
                label={column.label}
                tasks={loading ? [] : grouped[column.id]}
                highlighted={!!activeTask && overStatus === column.id}
                onOpenTask={(task) => {
                  if (task.status === 'studying') onOpenStudy(task)
                  else setSelectedTask(task)
                }}
              />
            ))}
            <DragOverlay dropAnimation={dropAnimation} zIndex={1000}>
              {activeTask ? <TaskCardView task={activeTask} overlay /> : null}
            </DragOverlay>
          </DndContext>
        </motion.div>
      </div>

      <TaskFormModal
        open={modalOpen}
        courses={courses}
        difficulties={difficulties}
        onClose={() => setModalOpen(false)}
        onCreate={async (input) => {
          await api.createTask(input)
          await loadTasks(filters)
        }}
      />

      <TaskDetailModal
        task={selectedTask}
        courses={courses}
        difficulties={difficulties}
        onClose={() => setSelectedTask(null)}
        onSave={async (input) => {
          await api.updateTask(input)
          await loadTasks(filters)
        }}
      />
    </div>
  )
}
