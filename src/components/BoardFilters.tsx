import type { Course, TaskFilters } from '../types'
import { DateField } from './ui/DateField'
import { SelectField } from './ui/SelectField'

interface Props {
  filters: TaskFilters
  courses: Course[]
  onChange: (next: TaskFilters) => void
}

export function BoardFilters({ filters, courses, onChange }: Props) {
  const courseOptions = [
    { value: '', label: 'Todos' },
    ...courses.map((course) => ({
      value: String(course.id),
      label: course.name,
    })),
  ]

  return (
    <div className="filters">
      <DateField
        label="Creada el"
        value={filters.created_on ?? ''}
        onChange={(created_on) =>
          onChange({
            ...filters,
            created_on: created_on || null,
          })
        }
      />

      <DateField
        label="Para el día"
        value={filters.due_on ?? ''}
        onChange={(due_on) =>
          onChange({
            ...filters,
            due_on: due_on || null,
          })
        }
      />

      <SelectField
        label="Curso"
        value={filters.course_id ? String(filters.course_id) : ''}
        options={courseOptions}
        placeholder="Todos"
        onChange={(courseId) =>
          onChange({
            ...filters,
            course_id: courseId ? Number(courseId) : null,
          })
        }
      />

      <button
        type="button"
        className="ghost filters-clear"
        onClick={() =>
          onChange({
            created_on: null,
            due_on: null,
            course_id: null,
            status: null,
          })
        }
      >
        Limpiar filtros
      </button>
    </div>
  )
}
