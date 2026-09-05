import { useDroppable } from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import type { Task, TaskStatus } from '../types'
import { TaskCard } from './TaskCard'

interface Props {
  status: TaskStatus
  label: string
  tasks: Task[]
  highlighted?: boolean
  onOpenTask: (task: Task) => void
}

export function KanbanColumn({
  status,
  label,
  tasks,
  highlighted = false,
  onOpenTask,
}: Props) {
  const { setNodeRef } = useDroppable({ id: status })

  return (
    <section
      ref={setNodeRef}
      className={`kanban-column${highlighted ? ' over' : ''}`}
    >
      <header>
        <h2>{label}</h2>
        <span>{tasks.length}</span>
      </header>
      <div className="kanban-column-body">
        <SortableContext
          items={tasks.map((task) => task.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} onOpen={onOpenTask} />
          ))}
        </SortableContext>
      </div>
    </section>
  )
}
