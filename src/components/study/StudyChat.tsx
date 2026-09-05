import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { StudyContext, StudyExercise, TutorPhase } from '../../lib/studyProtocol'
import { phaseLabel } from '../../lib/studyProtocol'

interface Props {
  context: StudyContext | null
  phase: TutorPhase | string
  exercise: StudyExercise | null
  sending: boolean
  error: string | null
  onSend: (message: string, includeBoard: boolean) => Promise<void>
}

export function StudyChat({
  context,
  phase,
  exercise,
  sending,
  error,
  onSend,
}: Props) {
  const [draft, setDraft] = useState('')
  const [includeBoard, setIncludeBoard] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [context?.messages, sending])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || sending) return
    const sendBoard = includeBoard
    setDraft('')
    try {
      await onSend(text, sendBoard)
      if (sendBoard) setIncludeBoard(false)
    } catch {
      // El error lo muestra el padre; si falló, el toggle se mantiene
    }
  }

  return (
    <section className="study-chat">
      <div className="study-chat-meta">
        <span className="study-phase-pill">{phaseLabel(phase)}</span>
        {context?.topic_summary ? (
          <p className="study-topic-summary">{context.topic_summary}</p>
        ) : (
          <p className="study-topic-summary muted">
            Tu tutor amigable ya tiene el título de la tarea y te espera.
          </p>
        )}
      </div>

      {exercise && (
        <div className="study-exercise">
          <strong>{exercise.title}</strong>
          <p>{exercise.instructions}</p>
        </div>
      )}

      <div className="study-chat-messages" ref={listRef}>
        {(context?.messages ?? []).length === 0 && (
          <p className="muted study-chat-empty">Escribe tu primer mensaje para empezar.</p>
        )}
        {(context?.messages ?? []).map((message, index) => (
          <div
            key={`${message.created_at}-${index}`}
            className={`study-bubble study-bubble-${message.role}`}
          >
            <span className="study-bubble-role">
              {message.role === 'user' ? 'Tú' : 'Tutor'}
            </span>
            <p>{message.content}</p>
          </div>
        ))}
        {sending && (
          <div className="study-bubble study-bubble-assistant is-typing">
            <span className="study-bubble-role">Tutor</span>
            <p>Pensando…</p>
          </div>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}

      <form className="study-chat-form" onSubmit={(e) => void onSubmit(e)}>
        <button
          type="button"
          className={`study-board-toggle${includeBoard ? ' is-on' : ''}`}
          role="switch"
          aria-checked={includeBoard}
          disabled={sending}
          onClick={() => setIncludeBoard((value) => !value)}
        >
          <span className="study-board-toggle-track" aria-hidden>
            <span className="study-board-toggle-thumb" />
          </span>
          <span className="study-board-toggle-title">Enviar pizarra</span>
        </button>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Escribe tu duda… Activa “Enviar pizarra” solo si quieres que mire el dibujo."
          rows={3}
          disabled={sending}
        />
        <button type="submit" className="primary" disabled={sending || !draft.trim()}>
          {sending ? 'Enviando…' : 'Enviar'}
        </button>
      </form>
    </section>
  )
}
