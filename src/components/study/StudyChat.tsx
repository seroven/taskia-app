import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { StudyContext, StudyExercise, StudyMessage, TutorPhase } from '../../lib/studyProtocol'
import { phaseLabel } from '../../lib/studyProtocol'

interface Props {
  context: StudyContext | null
  phase: TutorPhase | string
  exercise: StudyExercise | null
  sending: boolean
  error: string | null
  onSend: (
    message: string,
    options: { includeBoard: boolean; allowAiDraw: boolean },
  ) => Promise<void>
}

function messageKey(message: StudyMessage, index: number) {
  return `${message.created_at}-${message.role}-${index}`
}

function TypewriterText({
  text,
  active,
  onTick,
  onDone,
}: {
  text: string
  active: boolean
  onTick?: () => void
  onDone?: () => void
}) {
  const [shown, setShown] = useState(active ? '' : text)
  const onTickRef = useRef(onTick)
  const onDoneRef = useRef(onDone)
  onTickRef.current = onTick
  onDoneRef.current = onDone

  useEffect(() => {
    if (!active) {
      setShown(text)
      return
    }

    setShown('')
    let i = 0
    const delay = text.length > 220 ? 12 : text.length > 120 ? 16 : 22

    const id = window.setInterval(() => {
      i += 1
      setShown(text.slice(0, i))
      onTickRef.current?.()
      if (i >= text.length) {
        window.clearInterval(id)
        onDoneRef.current?.()
      }
    }, delay)

    return () => window.clearInterval(id)
  }, [text, active])

  return (
    <p>
      {shown}
      {active && shown.length < text.length && (
        <span className="study-type-caret" aria-hidden />
      )}
    </p>
  )
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
  const [allowAiDraw, setAllowAiDraw] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const bootstrapped = useRef(false)
  const [instantKeys, setInstantKeys] = useState<Set<string>>(() => new Set())
  const [typingKey, setTypingKey] = useState<string | null>(null)

  const messages = context?.messages ?? []

  useEffect(() => {
    if (!context || bootstrapped.current) return
    bootstrapped.current = true

    // Historial: mostrar al instante. Saludo único: animar.
    if (messages.length === 1 && messages[0]?.role === 'assistant') {
      setTypingKey(messageKey(messages[0], 0))
      setInstantKeys(new Set())
      return
    }

    const keys = new Set(messages.map((m, i) => messageKey(m, i)))
    setInstantKeys(keys)
    setTypingKey(null)
  }, [context, messages])

  useEffect(() => {
    if (!bootstrapped.current || messages.length === 0) return
    const lastIndex = messages.length - 1
    const last = messages[lastIndex]
    const key = messageKey(last, lastIndex)

    if (last.role !== 'assistant') return
    if (instantKeys.has(key) || typingKey === key) return

    // Nuevo mensaje del tutor → máquina de escribir
    setTypingKey(key)
  }, [messages, instantKeys, typingKey])

  const scrollToBottom = () => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, sending, typingKey])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || sending) return
    const sendBoard = includeBoard
    const draw = allowAiDraw
    setDraft('')
    try {
      await onSend(text, { includeBoard: sendBoard, allowAiDraw: draw })
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
        {messages.length === 0 && (
          <p className="muted study-chat-empty">Escribe tu primer mensaje para empezar.</p>
        )}
        {messages.map((message, index) => {
          const key = messageKey(message, index)
          const isAssistant = message.role === 'assistant'
          const shouldType = isAssistant && typingKey === key && !instantKeys.has(key)

          return (
            <motion.div
              key={key}
              className={`study-bubble study-bubble-${message.role}`}
              initial={isAssistant && shouldType ? { opacity: 0.6, y: 6 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              <span className="study-bubble-role">
                {message.role === 'user' ? 'Tú' : 'Tutor'}
              </span>
              {isAssistant ? (
                <TypewriterText
                  text={message.content}
                  active={shouldType}
                  onTick={scrollToBottom}
                  onDone={() => {
                    setInstantKeys((prev) => {
                      const next = new Set(prev)
                      next.add(key)
                      return next
                    })
                    setTypingKey((current) => (current === key ? null : current))
                    scrollToBottom()
                  }}
                />
              ) : (
                <p>{message.content}</p>
              )}
            </motion.div>
          )
        })}
        <AnimatePresence>
          {sending && (
            <motion.div
              key="thinking"
              className="study-bubble study-bubble-assistant is-typing"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
            >
              <span className="study-bubble-role">Tutor</span>
              <p>
                Pensando
                <span className="study-thinking-dots" aria-hidden>
                  <span />
                  <span />
                  <span />
                </span>
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {error && <p className="form-error">{error}</p>}

      <form className="study-chat-form" onSubmit={(e) => void onSubmit(e)}>
        <div className="study-chat-toggles">
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
          <button
            type="button"
            className={`study-board-toggle${allowAiDraw ? ' is-on' : ''}`}
            role="switch"
            aria-checked={allowAiDraw}
            disabled={sending}
            onClick={() => setAllowAiDraw((value) => !value)}
          >
            <span className="study-board-toggle-track" aria-hidden>
              <span className="study-board-toggle-thumb" />
            </span>
            <span className="study-board-toggle-title">IA dibuja</span>
          </button>
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Escribe tu duda… “Enviar pizarra” para que mire tu dibujo; “IA dibuja” para que ella dibuje el ejercicio."
          rows={3}
          disabled={sending}
        />
        <button
          type="submit"
          className={`primary study-send-btn${sending ? ' is-loading' : ''}`}
          disabled={sending || !draft.trim()}
          aria-busy={sending}
        >
          <AnimatePresence mode="wait" initial={false}>
            {sending ? (
              <motion.span
                key="loading"
                className="study-send-label"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              >
                <span className="study-send-spinner" aria-hidden />
                Enviando…
              </motion.span>
            ) : (
              <motion.span
                key="idle"
                className="study-send-label"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              >
                Enviar
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </form>
    </section>
  )
}
