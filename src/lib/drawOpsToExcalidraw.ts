import type { DrawOp } from './studyProtocol'

type ExcalidrawElement = Record<string, unknown>

const AI_CENTER_X = 480
const AI_CENTER_Y = 320
/** Tamaño deseado del dibujo (lado mayor), para que se vea grande y centrado. */
const AI_TARGET_SIZE = 360

function uid() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
}

function baseElement(
  type: string,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
): ExcalidrawElement {
  return {
    id: uid(),
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: color,
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 3,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: type === 'rectangle' || type === 'ellipse' ? { type: 3 } : null,
    seed: Math.floor(Math.random() * 2_000_000_000),
    version: 1,
    versionNonce: Math.floor(Math.random() * 2_000_000_000),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    customData: { layer: 'ai' },
    index: 'a' + Math.random().toString(36).slice(2, 8),
  }
}

function textElement(
  x: number,
  y: number,
  text: string,
  color: string,
  fontSize = 28,
): ExcalidrawElement {
  const width = Math.max(48, text.length * fontSize * 0.6)
  const height = fontSize * 1.4
  return {
    ...baseElement('text', x, y, width, height, color),
    text,
    fontSize,
    fontFamily: 1,
    textAlign: 'left',
    verticalAlign: 'top',
    containerId: null,
    originalText: text,
    autoResize: true,
    lineHeight: 1.25,
  }
}

function lineElement(
  type: 'line' | 'arrow',
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): ExcalidrawElement {
  return {
    ...baseElement(type, x, y, w, h, color),
    points: [
      [0, 0],
      [w, h],
    ],
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: type === 'arrow' ? 'arrow' : null,
  }
}

function triangleElement(
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): ExcalidrawElement {
  return {
    ...baseElement('line', x, y, w, h, color),
    points: [
      [w / 2, 0],
      [w, h],
      [0, h],
      [w / 2, 0],
    ],
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: null,
  }
}

function stampElements(
  id: string,
  x: number,
  y: number,
  scale: number,
): ExcalidrawElement[] {
  // Escala por defecto más grande (~2×) para ejercicios visibles.
  const s = Math.max(0.8, scale || 2)
  const color = '#2563eb'

  switch (id) {
    case 'right_triangle':
      return [
        {
          ...baseElement('line', x, y, 220 * s, 160 * s, color),
          points: [
            [0, 160 * s],
            [220 * s, 160 * s],
            [0, 0],
            [0, 160 * s],
          ],
          lastCommittedPoint: null,
          startBinding: null,
          endBinding: null,
          startArrowhead: null,
          endArrowhead: null,
        },
      ]
    case 'circle':
      return [baseElement('ellipse', x, y, 180 * s, 180 * s, color)]
    case 'square':
      return [baseElement('rectangle', x, y, 180 * s, 180 * s, color)]
    case 'number_line': {
      const width = 360 * s
      const midY = 32 * s
      const ticks: ExcalidrawElement[] = [
        lineElement('line', x, y + midY, width, 0, color),
      ]
      for (let i = 0; i <= 5; i += 1) {
        const tx = x + (width / 5) * i
        ticks.push(lineElement('line', tx, y + midY - 14 * s, 0, 28 * s, color))
        ticks.push(textElement(tx - 8, y + midY + 18 * s, String(i), color, 24))
      }
      return ticks
    }
    case 'arrow':
      return [lineElement('arrow', x, y, 200 * s, 0, color)]
    default:
      return [baseElement('rectangle', x, y, 140 * s, 140 * s, color)]
  }
}

function elementBounds(el: ExcalidrawElement): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  const x = Number(el.x ?? 0)
  const y = Number(el.y ?? 0)
  const w = Number(el.width ?? 0)
  const h = Number(el.height ?? 0)
  const points = el.points as [number, number][] | undefined

  if (points && points.length > 0) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const [px, py] of points) {
      minX = Math.min(minX, x + px)
      minY = Math.min(minY, y + py)
      maxX = Math.max(maxX, x + px)
      maxY = Math.max(maxY, y + py)
    }
    return { minX, minY, maxX, maxY }
  }

  return {
    minX: x,
    minY: y,
    maxX: x + Math.max(w, 1),
    maxY: y + Math.max(h, 1),
  }
}

/** Escala y centra el grupo de elementos de la IA en el lienzo. */
export function centerAndScaleAiElements(
  elements: ExcalidrawElement[],
): ExcalidrawElement[] {
  if (elements.length === 0) return elements

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const el of elements) {
    const b = elementBounds(el)
    minX = Math.min(minX, b.minX)
    minY = Math.min(minY, b.minY)
    maxX = Math.max(maxX, b.maxX)
    maxY = Math.max(maxY, b.maxY)
  }

  const width = Math.max(maxX - minX, 1)
  const height = Math.max(maxY - minY, 1)
  const scale = Math.min(
    AI_TARGET_SIZE / width,
    AI_TARGET_SIZE / height,
    3.5,
  )
  // Si ya es grande, no achicar demasiado; si es chico, agrandar.
  const finalScale = width < AI_TARGET_SIZE * 0.7 || height < AI_TARGET_SIZE * 0.7
    ? Math.max(scale, 1.4)
    : Math.min(Math.max(scale, 0.85), 2.2)

  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2

  return elements.map((el) => {
    const next = { ...el }
    const x = Number(el.x ?? 0)
    const y = Number(el.y ?? 0)
    next.x = AI_CENTER_X + (x - cx) * finalScale
    next.y = AI_CENTER_Y + (y - cy) * finalScale
    next.width = Number(el.width ?? 0) * finalScale
    next.height = Number(el.height ?? 0) * finalScale

    if (Array.isArray(el.points)) {
      next.points = (el.points as [number, number][]).map(([px, py]) => [
        px * finalScale,
        py * finalScale,
      ])
    }

    if (el.type === 'text' && typeof el.fontSize === 'number') {
      next.fontSize = Math.max(22, Math.round(el.fontSize * finalScale))
    }

    next.strokeWidth = Math.max(2, Math.round(Number(el.strokeWidth ?? 2) * Math.min(finalScale, 1.6)))
    next.version = Number(el.version ?? 1) + 1
    next.versionNonce = Math.floor(Math.random() * 2_000_000_000)
    next.updated = Date.now()
    return next
  })
}

/**
 * Aplica draw_ops de la IA: siempre limpia toda la pizarra primero,
 * dibuja las formas y las centra/agranda.
 */
export function applyDrawOpsToElements(
  _current: readonly ExcalidrawElement[],
  ops: DrawOp[],
): ExcalidrawElement[] {
  // Pedido de producto: al dibujar la IA, borrar toda la pizarra primero.
  let created: ExcalidrawElement[] = []

  for (const op of ops) {
    if (op.op === 'clear_layer' || op.op === 'clear_board') {
      continue
    }

    if (op.op === 'stamp') {
      created = [...created, ...stampElements(op.id, op.x, op.y, op.scale ?? 2)]
      continue
    }

    if (op.op === 'shape') {
      const color = op.color || '#2563eb'
      const w = op.w ?? 180
      const h = op.h ?? 140
      let batch: ExcalidrawElement[] = []

      switch (op.type) {
        case 'rectangle':
          batch = [baseElement('rectangle', op.x, op.y, w, h, color)]
          break
        case 'ellipse':
          batch = [baseElement('ellipse', op.x, op.y, w, h, color)]
          break
        case 'triangle':
          batch = [triangleElement(op.x, op.y, w, h, color)]
          break
        case 'line':
          batch = [lineElement('line', op.x, op.y, w, h, color)]
          break
        case 'arrow':
          batch = [lineElement('arrow', op.x, op.y, w, h || 0, color)]
          break
        case 'text':
          batch = [textElement(op.x, op.y, op.label || '?', color, 28)]
          break
        default:
          break
      }

      if (op.label && op.type !== 'text' && batch[0]) {
        batch.push(textElement(op.x + 12, op.y + 12, op.label, color, 26))
      }

      created = [...created, ...batch]
    }
  }

  return centerAndScaleAiElements(created)
}
