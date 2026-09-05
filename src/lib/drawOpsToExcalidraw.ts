import type { DrawOp } from './studyProtocol'

type ExcalidrawElement = Record<string, unknown>

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
    strokeWidth: 2,
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
): ExcalidrawElement {
  const fontSize = 20
  const width = Math.max(40, text.length * fontSize * 0.6)
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
  const s = Math.max(0.4, scale || 1)
  const color = '#2563eb'

  switch (id) {
    case 'right_triangle':
      return [
        {
          ...baseElement('line', x, y, 140 * s, 100 * s, color),
          points: [
            [0, 100 * s],
            [140 * s, 100 * s],
            [0, 0],
            [0, 100 * s],
          ],
          lastCommittedPoint: null,
          startBinding: null,
          endBinding: null,
          startArrowhead: null,
          endArrowhead: null,
        },
      ]
    case 'circle':
      return [baseElement('ellipse', x, y, 100 * s, 100 * s, color)]
    case 'square':
      return [baseElement('rectangle', x, y, 100 * s, 100 * s, color)]
    case 'number_line': {
      const width = 240 * s
      const midY = 24 * s
      const ticks: ExcalidrawElement[] = [
        lineElement('line', x, y + midY, width, 0, color),
      ]
      for (let i = 0; i <= 5; i += 1) {
        const tx = x + (width / 5) * i
        ticks.push(lineElement('line', tx, y + midY - 10 * s, 0, 20 * s, color))
        ticks.push(textElement(tx - 6, y + midY + 14 * s, String(i), color))
      }
      return ticks
    }
    case 'arrow':
      return [lineElement('arrow', x, y, 140 * s, 0, color)]
    default:
      return [baseElement('rectangle', x, y, 80 * s, 80 * s, color)]
  }
}

export function applyDrawOpsToElements(
  current: readonly ExcalidrawElement[],
  ops: DrawOp[],
): ExcalidrawElement[] {
  let next = current.map((el) => ({ ...el }))

  for (const op of ops) {
    if (op.op === 'clear_layer') {
      const layer = op.layer || 'ai'
      next = next.filter((el) => {
        const custom = el.customData as { layer?: string } | undefined
        return custom?.layer !== layer
      })
      continue
    }

    if (op.op === 'stamp') {
      next = [...next, ...stampElements(op.id, op.x, op.y, op.scale ?? 1)]
      continue
    }

    if (op.op === 'shape') {
      const color = op.color || '#2563eb'
      const w = op.w ?? 120
      const h = op.h ?? 80
      let created: ExcalidrawElement[] = []

      switch (op.type) {
        case 'rectangle':
          created = [baseElement('rectangle', op.x, op.y, w, h, color)]
          break
        case 'ellipse':
          created = [baseElement('ellipse', op.x, op.y, w, h, color)]
          break
        case 'triangle':
          created = [triangleElement(op.x, op.y, w, h, color)]
          break
        case 'line':
          created = [lineElement('line', op.x, op.y, w, h, color)]
          break
        case 'arrow':
          created = [lineElement('arrow', op.x, op.y, w, h || 0, color)]
          break
        case 'text':
          created = [textElement(op.x, op.y, op.label || '?', color)]
          break
        default:
          break
      }

      if (op.label && op.type !== 'text' && created[0]) {
        created.push(
          textElement(op.x + 8, op.y + 8, op.label, color),
        )
      }

      next = [...next, ...created]
    }
  }

  return next
}
