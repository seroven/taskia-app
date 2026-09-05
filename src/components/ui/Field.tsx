import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'

export function Field({
  label,
  children,
  className = '',
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={`field ${className}`.trim()}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  )
}

export function TextField({
  label,
  className = '',
  ...props
}: {
  label: string
  className?: string
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} className={className}>
      <input className="field-control" {...props} />
    </Field>
  )
}

export function TextAreaField({
  label,
  className = '',
  ...props
}: {
  label: string
  className?: string
} & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label} className={className}>
      <textarea className="field-control field-control--area" {...props} />
    </Field>
  )
}
