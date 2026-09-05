import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Field } from './Field'
import { useAnchoredPopoverStyle } from './useAnchoredPopoverStyle'

const WEEKDAYS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa', 'Do']

function parseISO(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== m - 1 ||
    date.getDate() !== d
  ) {
    return null
  }
  return date
}

function toISO(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1)
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function formatDisplay(value: string): string {
  const date = parseISO(value)
  if (!date) return 'Elegir fecha'
  return date.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

interface Props {
  label: string
  value: string
  required?: boolean
  className?: string
  onChange: (value: string) => void
}

export function DateField({
  label,
  value,
  required = false,
  className = '',
  onChange,
}: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const selected = parseISO(value)
  const [cursor, setCursor] = useState<Date>(
    () => startOfMonth(selected ?? new Date()),
  )
  const { style, placement } = useAnchoredPopoverStyle({
    open,
    anchorRef: triggerRef,
    estimatedHeight: 340,
    minWidth: 280,
  })

  useEffect(() => {
    const next = parseISO(value)
    if (next) setCursor(startOfMonth(next))
  }, [value])

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (rootRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const days = useMemo(() => {
    const first = startOfMonth(cursor)
    const startOffset = (first.getDay() + 6) % 7
    const gridStart = new Date(first)
    gridStart.setDate(first.getDate() - startOffset)
    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(gridStart)
      day.setDate(gridStart.getDate() + index)
      return day
    })
  }, [cursor])

  const monthLabel = cursor.toLocaleDateString('es-ES', {
    month: 'long',
    year: 'numeric',
  })

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setOpen((current) => !current)
    }
  }

  const today = new Date()

  return (
    <Field label={label} className={className}>
      <div className={`date-field${open ? ' is-open' : ''}`} ref={rootRef}>
        <button
          ref={triggerRef}
          type="button"
          className={`field-control date-trigger${open ? ' is-open' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          onKeyDown={onTriggerKeyDown}
        >
          <span className={value ? 'date-value' : 'date-placeholder'}>
            {formatDisplay(value)}
          </span>
          <span className="date-icon" aria-hidden>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
              <rect
                x="3.5"
                y="5.5"
                width="17"
                height="15"
                rx="3.5"
                stroke="currentColor"
                strokeWidth="2"
              />
              <path
                d="M3.5 10.5H20.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <path
                d="M8 3.5V7"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <path
                d="M16 3.5V7"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </span>
        </button>

        <input
          className="select-native-mirror"
          tabIndex={-1}
          aria-hidden
          required={required}
          value={value}
          onChange={() => undefined}
        />

        {createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                ref={popoverRef}
                className={`date-popover popover-layer placement-${placement}`}
                style={style}
                role="dialog"
                aria-label={label}
                initial={{
                  opacity: 0,
                  y: placement === 'down' ? -6 : 6,
                  scale: 0.98,
                }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{
                  opacity: 0,
                  y: placement === 'down' ? -4 : 4,
                  scale: 0.98,
                }}
                transition={{ duration: 0.16 }}
              >
                <div className="date-popover-header">
                  <button
                    type="button"
                    className="date-nav"
                    aria-label="Mes anterior"
                    onClick={() => setCursor((current) => addMonths(current, -1))}
                  >
                    ‹
                  </button>
                  <p className="date-month">{monthLabel}</p>
                  <button
                    type="button"
                    className="date-nav"
                    aria-label="Mes siguiente"
                    onClick={() => setCursor((current) => addMonths(current, 1))}
                  >
                    ›
                  </button>
                </div>

                <div className="date-weekdays">
                  {WEEKDAYS.map((day) => (
                    <span key={day}>{day}</span>
                  ))}
                </div>

                <div className="date-grid">
                  {days.map((day) => {
                    const inMonth = day.getMonth() === cursor.getMonth()
                    const isSelected = selected ? sameDay(day, selected) : false
                    const isToday = sameDay(day, today)
                    return (
                      <button
                        key={toISO(day)}
                        type="button"
                        className={[
                          'date-day',
                          inMonth ? '' : 'is-muted',
                          isSelected ? 'is-selected' : '',
                          isToday ? 'is-today' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => {
                          onChange(toISO(day))
                          setOpen(false)
                        }}
                      >
                        {day.getDate()}
                      </button>
                    )
                  })}
                </div>

                <div className="date-popover-footer">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      onChange(toISO(today))
                      setOpen(false)
                    }}
                  >
                    Hoy
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      onChange('')
                      setOpen(false)
                    }}
                  >
                    Limpiar
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
      </div>
    </Field>
  )
}
