import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Task } from '../types'

export function TaskCardView({
  task,
  overlay = false,
}: {
  task: Task
  overlay?: boolean
}) {
  return (
    <article className={`task-card${overlay ? ' task-card-overlay' : ''}`}>
      <div className="task-card-top">
        <span className="course-tag">{task.course_name}</span>
        <span className="due-tag">Para {task.due_date}</span>
      </div>
      <h3>{task.title}</h3>
      {task.description && <p>{task.description}</p>}
    </article>
  )
}

export function TaskCard({
  task,
  onOpen,
}: {
  task: Task
  onOpen: (task: Task) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`task-card-shell${isDragging ? ' is-dragging' : ''}`}
      onDoubleClick={() => onOpen(task)}
      {...attributes}
      {...listeners}
    >
      <TaskCardView task={task} />
    </div>
  )
}
