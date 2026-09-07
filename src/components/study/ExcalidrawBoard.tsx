import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import {
  CaptureUpdateAction,
  Excalidraw,
  exportToBlob,
} from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import '@excalidraw/excalidraw/index.css'
import { applyDrawOpsToElements } from '../../lib/drawOpsToExcalidraw'
import { STUDY_LIBRARY_ITEMS } from '../../lib/studyStamps'
import type { DrawOp, StudyBoardScene } from '../../lib/studyProtocol'

export interface BoardAttachment {
  description: string
  imageBase64: string | null
  elementCount: number
}

export interface ExcalidrawBoardHandle {
  applyDrawOps: (ops: DrawOp[]) => void
  getBoardAttachment: () => Promise<BoardAttachment>
}

interface Props {
  initialBoard: StudyBoardScene | null
  onSave: (board: StudyBoardScene) => void
  theme: 'light' | 'dark'
}

function describeElements(elements: readonly Record<string, unknown>[]): string {
  const alive = elements.filter((el) => !el.isDeleted)
  if (alive.length === 0) {
    return 'La pizarra está vacía.'
  }

  const lines = alive.slice(0, 40).map((el, index) => {
    const type = String(el.type ?? 'forma')
    const x = Math.round(Number(el.x ?? 0))
    const y = Math.round(Number(el.y ?? 0))
    const w = Math.round(Number(el.width ?? 0))
    const h = Math.round(Number(el.height ?? 0))
    const text = typeof el.text === 'string' ? el.text.trim() : ''
    if (type === 'text' && text) {
      return `${index + 1}. texto "${text}" en (${x}, ${y})`
    }
    if (text) {
      return `${index + 1}. ${type} "${text}" en (${x}, ${y}) ${w}x${h}`
    }
    return `${index + 1}. ${type} en (${x}, ${y}) ${w}x${h}`
  })

  const extra =
    alive.length > 40 ? `\n…y ${alive.length - 40} elementos más.` : ''
  return `El niño dibujó ${alive.length} elemento(s) en la pizarra:\n${lines.join('\n')}${extra}`
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/**
 * Excalidraw en theme dark aplica `filter: invert(...)` al <canvas>.
 * Por eso el color "lógico" del lienzo debe ser siempre blanco (#fff):
 * - light: se ve blanco
 * - dark: el filtro lo invierte y se ve negro
 * Si pusiéramos #000 en dark, el filtro lo volvería blanco (el bug que veíamos).
 */
const CANVAS_BACKGROUND = '#ffffff'

function resolveTheme(theme: 'light' | 'dark'): 'light' | 'dark' {
  const fromDom = document.documentElement.dataset.theme
  if (fromDom === 'light' || fromDom === 'dark') return fromDom
  return theme
}

export const ExcalidrawBoard = forwardRef<ExcalidrawBoardHandle, Props>(
  function ExcalidrawBoard({ initialBoard, onSave, theme }, ref) {
    const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
    const saveTimer = useRef<number | null>(null)
    const [ready, setReady] = useState(false)
    const activeTheme = resolveTheme(theme)

    const applyCanvasTheme = useCallback(
      (api: ExcalidrawImperativeAPI, nextTheme: 'light' | 'dark') => {
        api.updateScene({
          appState: {
            theme: nextTheme,
            viewBackgroundColor: CANVAS_BACKGROUND,
          },
          captureUpdate: CaptureUpdateAction.NEVER,
        })
      },
      [],
    )

    const persist = useCallback(() => {
      const api = apiRef.current
      if (!api) return
      const elements = api.getSceneElements()
      const files = api.getFiles()
      const nextTheme = resolveTheme(theme)
      onSave({
        type: 'excalidraw',
        version: 2,
        source: 'taskia',
        elements: elements as unknown[],
        appState: {
          viewBackgroundColor: CANVAS_BACKGROUND,
          theme: nextTheme,
        },
        files: files as Record<string, unknown>,
      })
    }, [onSave, theme])

    useEffect(() => {
      const api = apiRef.current
      if (!api || !ready) return
      const nextTheme = resolveTheme(theme)
      applyCanvasTheme(api, nextTheme)
      const t1 = window.setTimeout(() => applyCanvasTheme(api, nextTheme), 50)
      const t2 = window.setTimeout(() => applyCanvasTheme(api, nextTheme), 200)
      return () => {
        window.clearTimeout(t1)
        window.clearTimeout(t2)
      }
    }, [theme, ready, applyCanvasTheme])

    useImperativeHandle(ref, () => ({
      applyDrawOps(ops: DrawOp[]) {
        const api = apiRef.current
        if (!api || ops.length === 0) return
        const current = api.getSceneElements() as unknown as Record<string, unknown>[]
        const next = applyDrawOpsToElements(current, ops)
        api.updateScene({
          elements: next as unknown as ReturnType<
            ExcalidrawImperativeAPI['getSceneElements']
          >,
          captureUpdate: CaptureUpdateAction.NEVER,
        })
        // Enfoca el dibujo centrado de la IA
        window.requestAnimationFrame(() => {
          try {
            api.scrollToContent(next as never, {
              fitToContent: true,
              animate: true,
              duration: 280,
            })
          } catch {
            // scrollToContent puede fallar si la API cambia; el dibujo igual queda.
          }
        })
        window.setTimeout(() => persist(), 50)
      },
      async getBoardAttachment() {
        const api = apiRef.current
        if (!api) {
          return {
            description: 'La pizarra no está lista.',
            imageBase64: null,
            elementCount: 0,
          }
        }

        const elements = api.getSceneElements()
        const appState = api.getAppState()
        const files = api.getFiles()
        const description = describeElements(
          elements as unknown as Record<string, unknown>[],
        )
        const elementCount = elements.filter((el) => !el.isDeleted).length

        if (elementCount === 0) {
          return { description, imageBase64: null, elementCount: 0 }
        }

        try {
          const nextTheme = resolveTheme(theme)
          const blob = await exportToBlob({
            elements,
            appState: {
              ...appState,
              exportBackground: true,
              exportWithDarkMode: nextTheme === 'dark',
              viewBackgroundColor: CANVAS_BACKGROUND,
            },
            files,
            mimeType: 'image/png',
            maxWidthOrHeight: 640,
          })
          const imageBase64 = await blobToBase64(blob)
          return { description, imageBase64, elementCount }
        } catch {
          return { description, imageBase64: null, elementCount }
        }
      },
    }))

    useEffect(() => {
      return () => {
        if (saveTimer.current) window.clearTimeout(saveTimer.current)
      }
    }, [])

    const { viewBackgroundColor: _ignoredBg, theme: _ignoredTheme, ...restAppState } =
      (initialBoard?.appState ?? {}) as Record<string, unknown>

    return (
      <div
        className={`study-board-wrap${ready ? ' is-ready' : ''}`}
        data-canvas-theme={activeTheme}
      >
        <Excalidraw
          langCode="es-ES"
          theme={activeTheme}
          initialData={{
            elements: (initialBoard?.elements ?? []) as never,
            appState: {
              ...restAppState,
              viewBackgroundColor: CANVAS_BACKGROUND,
              theme: activeTheme,
            },
            files: (initialBoard?.files as never) ?? undefined,
            libraryItems: STUDY_LIBRARY_ITEMS as never,
          }}
          UIOptions={{
            canvasActions: {
              loadScene: false,
              export: false,
              saveAsImage: false,
            },
          }}
          excalidrawAPI={(api) => {
            apiRef.current = api
            applyCanvasTheme(api, resolveTheme(theme))
            setReady(true)
          }}
          onChange={() => {
            if (saveTimer.current) window.clearTimeout(saveTimer.current)
            saveTimer.current = window.setTimeout(() => persist(), 650)
          }}
        />
      </div>
    )
  },
)
