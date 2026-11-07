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

/** Where practice's keys reach: inside `root`, except inside any of `outside`. */
export interface PracticeKeyScope {
  root: RefObject<Element | null>
  outside?: readonly RefObject<Element | null>[]
}

/**
 * True for a key pressed inside `scope`, or with focus on nothing. A key pressed in a list or a
 * control beside it belongs to that, and to the app's shortcuts, as does one in a part `scope`
 * leaves out, such as a page's attribute rows.
 */
export const inPractice = (target: EventTarget | null, scope: PracticeKeyScope) => {
  if (!(target instanceof Element) || target === document.body) return true
  if (!scope.root.current?.contains(target)) return false
  return !scope.outside?.some((part) => part.current?.contains(target))
}

export interface PracticeKeyActions {
  scope: PracticeKeyScope
  /** True while no overlay sits over practice, the only time the keys reach it. */
  isTop: () => boolean
  /** Why practice is paused, which turns every key off. */
  blocked?: string
  /** False while the audio is not loaded, which turns N, L, `[`, and `]` off. */
  canEdit: boolean
  trimStartMs: number
  /** Stops a momentum scroll under way where it shows, ahead of any key that acts at the playhead. */
  settle: () => void
  /** The playhead where it shows on the trimmed timeline, a scrub under way included. */
  shownPositionMs: () => number
  selectedId: string | null
  isRenaming: () => boolean
  togglePlay: () => void
  /** `atMs` is the playhead on the source timeline. */
  setEdge: (edge: 'start' | 'end', atMs: number) => void
  create: (atMs: number) => void
  /** How many loops the zoomed waveform holds, which the digit keys pick from. */
  loopCount: number
  /** Selects the loop at `index` in waveform order and returns its start on the source timeline. */
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
      if (isTextEntry(event.target) || !inPractice(event.target, keys.scope) || !keys.isTop()) {
        return
      }
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
    // At capture, so a key practice takes is spent before the app's shortcuts, which share
    // Space and N, hear it.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
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
