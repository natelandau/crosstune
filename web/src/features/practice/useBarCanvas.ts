import { useCallback, useEffect, useRef, useState } from 'react'
import type { Scheme } from '../../theme/tokens'
import { useScheme } from '../../theme/useScheme'

/**
 * The classes a bar canvas carries. The draw reads both bar colors off the canvas, the unplayed
 * one from its border color, which paints nothing without a border width, so the browser
 * resolves each.
 */
export const BAR_CANVAS_CLASS =
  'ph-no-capture block w-full border-(--wave-unplayed) text-(--wave-played)'

interface Surface {
  width: number
  height: number
  theme: Scheme
  scale: number
  played: string
  unplayed: string
}

/** A cleared canvas to draw bars on, in CSS pixels. */
export interface BarDraw {
  context: CanvasRenderingContext2D
  width: number
  height: number
  /** Device pixels per CSS pixel. */
  scale: number
  played: string
  unplayed: string
}

/**
 * A canvas that tracks its own size and the bar colors. `begin` clears it for a draw and is
 * null until the canvas has a size; it changes on a resize or a theme change, so a draw effect
 * that depends on it repaints then.
 */
export function useBarCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const surface = useRef<Surface | null>(null)
  // The bar colors are read again whenever the scheme stamped on the root changes.
  const theme = useScheme()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // An observer reports the size it starts with, so this also takes the first measurement.
    const observer = new ResizeObserver(() => {
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  const begin = useCallback((): BarDraw | null => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context || size.width === 0) return null
    const { width, height } = size
    // Sizing the backing store and reading the color are the costly steps, so they run again
    // only on a resize or a theme change, never on a position tick.
    let current = surface.current
    if (
      !current ||
      current.width !== width ||
      current.height !== height ||
      current.theme !== theme
    ) {
      const scale = window.devicePixelRatio || 1
      canvas.width = width * scale
      canvas.height = height * scale
      context.setTransform(scale, 0, 0, scale, 0, 0)
      const style = getComputedStyle(canvas)
      current = {
        width,
        height,
        theme,
        scale,
        played: style.color,
        unplayed: style.borderTopColor,
      }
      surface.current = current
    }
    context.clearRect(0, 0, width, height)
    return { context, ...current }
  }, [size, theme])

  return { canvasRef, size, begin }
}
