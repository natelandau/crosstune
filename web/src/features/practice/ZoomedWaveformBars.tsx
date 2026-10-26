import { useLayoutEffect } from 'react'
import { BAR_STEP, BAR_WIDTH, MIN_BAR } from '../capture/waveformBars'
import { gridLevel } from '../waveform/peaks'
import type { Moving } from '../player/playheadClock'
import type { ShownPeaks } from './recordingRange'
import { BAR_CANVAS_CLASS, useBarCanvas, type BarDraw } from './useBarCanvas'

/**
 * The recording's bars across the zoomed view, `startMs` (trimmed timeline) at its left edge
 * and the playhead at its center. The view moves outside React, so the bars are drawn again
 * whenever `startMs` reports a move. Each bar covers a fixed stretch of the recording at this
 * scale, so a scroll moves the bars rather than resampling them under a still comb. Before
 * the start and after the end the view stays blank; without peaks, or with none in the trim,
 * the recording is one plain bar.
 */
export function ZoomedWaveformBars({
  shown,
  startMs,
  pxPerS,
  lengthMs,
  heightClass,
}: {
  shown: ShownPeaks | null
  startMs: Moving<number>
  pxPerS: number
  lengthMs: number
  heightClass: string
}) {
  const { canvasRef, scale, begin } = useBarCanvas()

  useLayoutEffect(() => {
    const drawBars = (draw: BarDraw, offsetX: number) => {
      const { context, width, height } = draw
      const centerX = width / 2
      if (!shown || shown.peaks.values.length === 0) {
        const x0 = Math.max(0, -offsetX)
        const x1 = Math.min(width, (lengthMs / 1000) * pxPerS - offsetX)
        if (x1 <= x0) return
        const y = (height - MIN_BAR * 2) / 2
        const playedTo = Math.min(Math.max(centerX, x0), x1)
        context.fillStyle = draw.played
        context.fillRect(x0, y, playedTo - x0, MIN_BAR * 2)
        context.fillStyle = draw.unplayed
        context.fillRect(playedTo, y, x1 - playedTo, MIN_BAR * 2)
        return
      }
      const barMs = (BAR_STEP / pxPerS) * 1000
      const first = Math.max(0, Math.floor(offsetX / BAR_STEP))
      const last = Math.min(
        Math.ceil(lengthMs / barMs) - 1,
        Math.floor((offsetX + width) / BAR_STEP),
      )
      for (let index = first; index <= last; index++) {
        const level = gridLevel(shown.peaks, barMs, index, shown.loudest)
        if (level === null) break
        const x = index * BAR_STEP - offsetX
        const bar = Math.max(MIN_BAR, level * height)
        context.fillStyle = x + BAR_WIDTH / 2 < centerX ? draw.played : draw.unplayed
        context.fillRect(x, (height - bar) / 2, BAR_WIDTH, bar)
      }
    }
    let drawnX: number | null = null
    const paint = () => {
      // Every bar lands on the same device-pixel phase, so its edges keep their sharpness as it
      // moves, and a scroll of less than a device pixel needs no redraw.
      const offsetX = Math.round((startMs.get() / 1000) * pxPerS * scale) / scale
      if (offsetX === drawnX) return
      const draw = begin()
      if (!draw) return
      drawnX = offsetX
      drawBars(draw, offsetX)
    }
    paint()
    return startMs.subscribe(paint)
  }, [begin, shown, startMs, pxPerS, lengthMs, scale])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-bars
      className={`${BAR_CANVAS_CLASS} ${heightClass}`}
    />
  )
}
