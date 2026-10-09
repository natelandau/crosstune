import { useEffect, useRef } from 'react'
import { useReducedMotion } from '../../platform/motion'
import { barCount, createLevels, eachBar, pushLevel, rmsLevel } from './waveformBars'
import { useLatest } from '../../ui/useLatest'

/**
 * A bar waveform drawn from the analyser's time domain, one level per animation frame. It
 * scrolls, or under reduced motion updates fixed bars in place.
 */
export function LiveWaveform({
  analyser,
  paused,
  active,
  className = 'text-(--wave-played)',
}: {
  analyser: AnalyserNode | null
  /** Hold the bars still, as during an interruption, without stopping the loop. */
  paused: boolean
  /** Run the animation loop at all; false once there is nothing left to show. */
  active: boolean
  /** Sets the bars' color through `color`. */
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pausedRef = useLatest(paused)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !analyser || !active) return
    const context = canvas.getContext('2d')
    if (!context) return
    const data = new Uint8Array(analyser.fftSize)
    const state = createLevels(reduceMotion ? 'fixed' : 'scrolling')
    let frame = 0
    // Measured only on a resize, so a frame reads no layout.
    let width = 0
    let height = 0
    const resize = () => {
      const scale = window.devicePixelRatio || 1
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = width * scale
      canvas.height = height * scale
      context.setTransform(scale, 0, 0, scale, 0, 0)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    const color = getComputedStyle(canvas).color
    const fillBar = (x: number, y: number, w: number, h: number) => context.fillRect(x, y, w, h)

    const draw = () => {
      frame = requestAnimationFrame(draw)
      if (!pausedRef.current) {
        analyser.getByteTimeDomainData(data)
        pushLevel(state, rmsLevel(data), barCount(width))
      }
      context.clearRect(0, 0, width, height)
      context.fillStyle = color
      eachBar(state, width, height, fillBar)
    }
    draw()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [analyser, active, reduceMotion, pausedRef])

  // The draw loop reads this color off the canvas, so the bars follow the palette in either theme.
  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`ph-no-capture block h-32 w-full ${className}`}
    />
  )
}
