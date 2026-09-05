import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Field } from './Field'
import { useAnchoredPopoverStyle } from './useAnchoredPopoverStyle'

export interface SelectOption {
  value: string
  label: string
}

interface Props {
  label: string
  value: string
  options: SelectOption[]
  placeholder?: string
  required?: boolean
  className?: string
  onChange: (value: string) => void
}

export function SelectField({
  label,
  value,
  options,
  placeholder = 'Selecciona…',
  required = false,
  className = '',
  onChange,
}: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const { style, placement } = useAnchoredPopoverStyle({
    open,
    anchorRef: triggerRef,
    estimatedHeight: Math.min(240, 48 + options.length * 48),
  })

  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  )

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (rootRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
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

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setOpen((current) => !current)
    }
  }

  return (
    <Field label={label} className={className}>
      <div className={`select-field${open ? ' is-open' : ''}`} ref={rootRef}>
        <button
          ref={triggerRef}
          type="button"
          className={`field-control select-trigger${open ? ' is-open' : ''}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((current) => !current)}
          onKeyDown={onTriggerKeyDown}
        >
          <span className={selected ? 'select-value' : 'select-placeholder'}>
            {selected?.label ?? placeholder}
          </span>
          <span className="select-chevron" aria-hidden>
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none">
              <path
                d="M5 7.5L10 12.5L15 7.5"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
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
                ref={menuRef}
                id={listId}
                role="listbox"
                className={`select-menu popover-layer placement-${placement}`}
                style={style}
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
                {options.map((option) => {
                  const active = option.value === value
                  return (
                    <button
                      key={option.value || '__empty'}
                      type="button"
                      role="option"
                      aria-selected={active}
                      className={`select-option${active ? ' is-active' : ''}`}
                      onClick={() => {
                        onChange(option.value)
                        setOpen(false)
                      }}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
      </div>
    </Field>
  )
}
