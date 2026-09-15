import { useReducedMotion } from 'motion/react'
import { useEffect, useRef } from 'react'
import { barCount, createLevels, layoutBars, pushLevel, rmsLevel } from './waveformBars'

/**
 * A bar waveform drawn from the analyser's time domain, one level per animation frame. It
 * scrolls, or under reduced motion updates fixed bars in place.
 */
export function LiveWaveform({
  analyser,
  paused,
  active,
}: {
  analyser: AnalyserNode | null
  /** Hold the bars still, as during an interruption, without stopping the loop. */
  paused: boolean
  /** Run the animation loop at all; false once there is nothing left to show. */
  active: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pausedRef = useRef(paused)
  const reduceMotion = useReducedMotion() ?? false
  useEffect(() => {
    pausedRef.current = paused
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !analyser || !active) return
    const context = canvas.getContext('2d')
    if (!context) return
    const data = new Uint8Array(analyser.fftSize)
    const state = createLevels(reduceMotion ? 'fixed' : 'scrolling')
    let frame = 0
    const resize = () => {
      const scale = window.devicePixelRatio || 1
      canvas.width = canvas.clientWidth * scale
      canvas.height = canvas.clientHeight * scale
      context.setTransform(scale, 0, 0, scale, 0, 0)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    const color = getComputedStyle(canvas).color

    const draw = () => {
      frame = requestAnimationFrame(draw)
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (!pausedRef.current) {
        analyser.getByteTimeDomainData(data)
        pushLevel(state, rmsLevel(data), barCount(width))
      }
      context.clearRect(0, 0, width, height)
      context.fillStyle = color
      for (const bar of layoutBars(state, width, height)) {
        context.fillRect(bar.x, bar.y, bar.width, bar.height)
      }
    }
    draw()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [analyser, active, reduceMotion])

  return <canvas ref={canvasRef} aria-hidden="true" className="text-primary block h-32 w-full" />
}
