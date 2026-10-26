import { SHEET } from './sheetGeometry'

const SURFACE_RADIUS = 14

interface Saved {
  root: HTMLElement
  transform: string
  transformOrigin: string
  willChange: string
  clipPath: string
  background: string
  bodyBackground: string
}

interface Entry {
  progress: number
}

// One stack for the page, because sheets overlap while one exits and the next enters: the
// first sheet in takes the snapshot and the last one out restores. The page follows the
// highest sheet, so a handoff never lets it fall flat while the next one rises.
const stack: Entry[] = []
let saved: Saved | null = null

function write(): void {
  if (!saved) return
  const progress = Math.max(...stack.map((entry) => entry.progress))
  const { root } = saved
  const width = window.innerWidth
  const fullScale = (width - SHEET.topMargin) / width
  const shift = progress * (SHEET.topMargin - SURFACE_RADIUS)
  root.style.transform = `translateY(${shift}px) scale(${1 - progress * (1 - fullScale)})`
}

function snapshot(): void {
  const root = document.querySelector<HTMLElement>('[data-sheet-root]')
  if (!root) return
  const body = document.body
  saved = {
    root,
    transform: root.style.transform,
    transformOrigin: root.style.transformOrigin,
    willChange: root.style.willChange,
    clipPath: root.style.clipPath,
    background: root.style.backgroundColor,
    bodyBackground: body.style.backgroundColor,
  }
  // Scale about the viewport's top edge, wherever the page is scrolled.
  root.style.transformOrigin = `50% ${-root.getBoundingClientRect().top}px`
  // A fixed clip on its own layer, so a frame of the background scale moves the page without repainting
  // it. The corners take their full radius from the first frame rather than growing.
  root.style.willChange = 'transform'
  root.style.clipPath = `inset(0 round ${SURFACE_RADIUS}px)`
  root.style.backgroundColor = 'var(--ground)'
  body.style.backgroundColor = '#000'
}

function restore(): void {
  if (!saved) return
  const { root } = saved
  root.style.transform = saved.transform
  root.style.transformOrigin = saved.transformOrigin
  root.style.willChange = saved.willChange
  root.style.clipPath = saved.clipPath
  root.style.backgroundColor = saved.background
  document.body.style.backgroundColor = saved.bodyBackground
  saved = null
}

export interface BackgroundScale {
  /** How far this sheet has risen, 0 closed to 1 full. */
  set: (progress: number) => void
  release: () => void
}

/**
 * Joins the page's background scale, scaling `[data-sheet-root]` back while any touch sheet shows. Every
 * style it writes there and on the body is restored when the last sheet releases.
 */
export function scaleBackground(): BackgroundScale {
  if (stack.length === 0) snapshot()
  const entry: Entry = { progress: 0 }
  stack.push(entry)
  return {
    set: (progress) => {
      entry.progress = progress
      write()
    },
    release: () => {
      const index = stack.indexOf(entry)
      if (index === -1) return
      stack.splice(index, 1)
      if (stack.length === 0) restore()
      else write()
    },
  }
}
