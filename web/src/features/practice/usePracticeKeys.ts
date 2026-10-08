import { useEffect, useLayoutEffect, type RefObject } from 'react'
import { useLatest } from '../../ui/useLatest'
import { isControl, isTextEntry } from '../../ui/keyTarget'
import { usePlaybackEngine } from '../player/PlaybackEngineProvider'
import { ZOOM_STEP } from './panel'
import { ARROW_LARGE_STEP_MS, ARROW_STEP_MS } from './PracticeWaveform'

/** True when the keystroke lands on a button, link, or mode tab, which keeps Enter for itself. */
const isButton = (target: EventTarget | null) =>
  !!(target as HTMLElement | null)?.closest?.('button, a, [role="button"], [role="tab"]')

/**
 * A mode tab, like any control, keeps the arrows for itself. Space belongs only to buttons: a
 * slider has no use for it, so it plays and pauses with the waveform or a handle focused.
 */
const keepsTransportKey = (key: string, target: EventTarget | null) =>
  key === ' ' ? isButton(target) : isControl(target) || isButton(target)

export interface PracticeKeyActions {
  /** True while practice is the topmost overlay, the only one the keys reach. */
  isTop: () => boolean
  /** Why practice stands down, which turns every key off. */
  blocked?: string
  /** False while the audio is not loaded, which turns N, L, `[`, and `]` off. */
  canEdit: boolean
  trimStartMs: number
  /** Stops a glide under way where it shows, ahead of any key that acts at the playhead. */
  settle: () => void
  /** The playhead where it shows on the trimmed timeline, a scrub under way included. */
  shownPositionMs: () => number
  selectedId: string | null
  isRenaming: () => boolean
  togglePlay: () => void
  /** `atMs` is the playhead on the source timeline. */
  setEdge: (edge: 'start' | 'end', atMs: number) => void
  create: (atMs: number) => void
  /** How many loops the lanes hold, which the digit keys pick from. */
  loopCount: number
  /** Selects the loop at `index` in lane order and returns its start on the source timeline. */
  selectLoop: (index: number) => number
  removeSelected: () => void
  startRename: (id: string) => void
  endRename: () => void
  deselect: () => void
  zoom: (factor: number) => void
}

/**
 * Practice's keys while it holds the keyboard and no field does: Space, the arrows, `[` and
 * `]`, N or L, 1 to 9, Delete or Backspace, Enter, and Ctrl or Command with plus and minus. Escape reaches
 * here through `escapeRef`, ahead of closing practice: it ends a rename, then deselects.
 */
export function usePracticeKeys(
  escapeRef: RefObject<(() => boolean) | null> | undefined,
  actions: PracticeKeyActions,
): void {
  const engine = usePlaybackEngine()
  const actionsRef = useLatest(actions)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const keys = actionsRef.current
      if (isTextEntry(event.target) || !keys.isTop()) return
      if (keys.blocked) return
      const key = event.key
      if (event.ctrlKey || event.metaKey) {
        const factor = key === '=' || key === '+' ? ZOOM_STEP : key === '-' ? 1 / ZOOM_STEP : 0
        if (factor === 0 || event.altKey) return
        // Otherwise the browser zooms the whole page.
        event.preventDefault()
        keys.zoom(factor)
        return
      }
      if (event.altKey) return
      const lengthMs = engine.getState().lengthMs
      if (key === ' ' || key === 'ArrowLeft' || key === 'ArrowRight') {
        if (keepsTransportKey(key, event.target) || lengthMs === 0) return
        if (key === ' ' && event.repeat) return
        event.preventDefault()
        if (key === ' ') {
          keys.togglePlay()
          return
        }
        const step = event.shiftKey ? ARROW_LARGE_STEP_MS : ARROW_STEP_MS
        keys.settle()
        engine.seek(keys.shownPositionMs() + (key === 'ArrowLeft' ? -step : step))
        return
      }
      if (event.repeat) return
      const isNew = key === 'n' || key === 'N' || key === 'l' || key === 'L'
      const digit = /^[1-9]$/.test(key) ? Number(key) : 0
      if (isNew || key === '[' || key === ']') {
        if (!keys.canEdit) return
        event.preventDefault()
        keys.settle()
        // Read after settling: a playing engine can be ahead of the last render.
        const atMs = keys.trimStartMs + keys.shownPositionMs()
        if (isNew) keys.create(atMs)
        else keys.setEdge(key === '[' ? 'start' : 'end', atMs)
      } else if (digit > 0) {
        if (digit > keys.loopCount || lengthMs === 0) return
        event.preventDefault()
        keys.settle()
        // As the loop switcher does, the picked loop's start comes under the playhead.
        engine.seek(keys.selectLoop(digit - 1) - keys.trimStartMs)
      } else if ((key === 'Delete' || key === 'Backspace') && keys.selectedId) {
        event.preventDefault()
        keys.removeSelected()
      } else if (key === 'Enter' && keys.selectedId && !isButton(event.target)) {
        event.preventDefault()
        keys.startRename(keys.selectedId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [engine, actionsRef])

  useLayoutEffect(() => {
    if (!escapeRef) return
    escapeRef.current = () => {
      const keys = actionsRef.current
      if (keys.isRenaming()) {
        keys.endRename()
        return true
      }
      if (keys.selectedId) {
        keys.deselect()
        return true
      }
      return false
    }
    return () => {
      escapeRef.current = null
    }
  }, [escapeRef, actionsRef])
}
