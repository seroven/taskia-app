import {
  useLayoutEffect,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react'

interface Options {
  open: boolean
  anchorRef: RefObject<HTMLElement | null>
  /** Estimated popover height to decide up vs down */
  estimatedHeight: number
  /** Optional minimum width; defaults to anchor width */
  minWidth?: number
  gap?: number
}

/**
 * Positions a portal popover with position:fixed so it never expands
 * document height (avoids app scrollbar flicker). Opens down or up
 * based on available viewport space.
 */
export function useAnchoredPopoverStyle({
  open,
  anchorRef,
  estimatedHeight,
  minWidth,
  gap = 8,
}: Options) {
  const [style, setStyle] = useState<CSSProperties>({
    position: 'fixed',
    top: 0,
    left: 0,
    visibility: 'hidden',
    pointerEvents: 'none',
    zIndex: 90,
  })
  const [placement, setPlacement] = useState<'up' | 'down'>('down')

  useLayoutEffect(() => {
    if (!open) {
      setStyle({
        position: 'fixed',
        top: 0,
        left: 0,
        visibility: 'hidden',
        pointerEvents: 'none',
        zIndex: 90,
      })
      return
    }

    function place() {
      const anchor = anchorRef.current
      if (!anchor) return

      const rect = anchor.getBoundingClientRect()
      const width = Math.max(rect.width, minWidth ?? rect.width)
      const maxLeft = window.innerWidth - width - 12
      const left = Math.min(Math.max(12, rect.left), Math.max(12, maxLeft))

      const spaceBelow = window.innerHeight - rect.bottom - 12
      const spaceAbove = rect.top - 12
      const openDown =
        spaceBelow >= estimatedHeight || spaceBelow >= spaceAbove

      setPlacement(openDown ? 'down' : 'up')

      if (openDown) {
        const maxHeight = Math.max(120, spaceBelow)
        setStyle({
          position: 'fixed',
          top: rect.bottom + gap,
          left,
          width,
          maxHeight,
          zIndex: 90,
          visibility: 'visible',
          pointerEvents: 'auto',
        })
      } else {
        const maxHeight = Math.max(120, spaceAbove)
        setStyle({
          position: 'fixed',
          bottom: window.innerHeight - rect.top + gap,
          left,
          width,
          maxHeight,
          zIndex: 90,
          visibility: 'visible',
          pointerEvents: 'auto',
        })
      }
    }

    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, anchorRef, estimatedHeight, minWidth, gap])

  return { style, placement }
}
