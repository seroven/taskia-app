export type TutorPhase = 'understanding' | 'practicing' | 'reviewing'

export interface StudyMessage {
  role: string
  content: string
  created_at: string
}

export interface StudyContext {
  task_id: number
  updated_at: string
  tutor_phase: TutorPhase
  topic_summary: string
  /** Resumen vivo enviado a Gemini (no el chat completo). */
  context_summary: string
  hints_level?: number
  messages: StudyMessage[]
}

export interface StudyExercise {
  id: string
  title: string
  instructions: string
  expected_interaction: string
}

export type DrawOp =
  | { op: 'clear_board' }
  | { op: 'clear_layer'; layer: string }
  | {
      op: 'shape'
      type: 'rectangle' | 'ellipse' | 'triangle' | 'line' | 'arrow' | 'text'
      x: number
      y: number
      w?: number
      h?: number
      label?: string
      color?: string
    }
  | {
      op: 'stamp'
      id: string
      x: number
      y: number
      scale?: number
    }

export interface GeminiTutorReply {
  phase: TutorPhase | string
  speak_to_child: string
  ask_questions: string[]
  topic_summary: string
  context_summary?: string
  user_memory_summary?: string
  exercise: StudyExercise | null
  draw_ops: DrawOp[]
  hints_level: number
  study_eval?: {
    passed: boolean
    evidence: string
  }
}

export interface StudyBoardScene {
  type?: string
  version?: number
  source?: string
  elements: unknown[]
  appState?: Record<string, unknown>
  files?: Record<string, unknown>
}

export interface StudySession {
  context: StudyContext
  board: StudyBoardScene
  task: import('../types').Task
}

export interface StudyChatResponse {
  reply: GeminiTutorReply
  context: StudyContext
  study_passed: boolean
}

export function phaseLabel(phase: string): string {
  switch (phase) {
    case 'practicing':
      return 'Practicando'
    case 'reviewing':
      return 'Repasando'
    default:
      return 'Entendiendo'
  }
}

export function parseDrawOps(raw: unknown): DrawOp[] {
  if (!Array.isArray(raw)) return []
  const ops: DrawOp[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const op = (item as { op?: string }).op
    if (op === 'clear_board') {
      ops.push({ op: 'clear_board' })
      continue
    }
    if (op === 'clear_layer') {
      ops.push({
        op: 'clear_layer',
        layer: String((item as { layer?: string }).layer ?? 'ai'),
      })
      continue
    }
    if (op === 'shape') {
      const shape = item as {
        type?: string
        x?: number
        y?: number
        w?: number
        h?: number
        label?: string
        color?: string
      }
      const type = shape.type
      if (
        type !== 'rectangle' &&
        type !== 'ellipse' &&
        type !== 'triangle' &&
        type !== 'line' &&
        type !== 'arrow' &&
        type !== 'text'
      ) {
        continue
      }
      ops.push({
        op: 'shape',
        type,
        x: Number(shape.x ?? 0),
        y: Number(shape.y ?? 0),
        w: shape.w != null ? Number(shape.w) : undefined,
        h: shape.h != null ? Number(shape.h) : undefined,
        label: shape.label,
        color: shape.color,
      })
      continue
    }
    if (op === 'stamp') {
      const stamp = item as {
        id?: string
        x?: number
        y?: number
        scale?: number
      }
      if (!stamp.id) continue
      ops.push({
        op: 'stamp',
        id: String(stamp.id),
        x: Number(stamp.x ?? 0),
        y: Number(stamp.y ?? 0),
        scale: stamp.scale != null ? Number(stamp.scale) : 1,
      })
    }
  }
  return ops
}
