import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react'
import { useFrame } from '../../platform/frame'
import { DONE } from '../../ui/confirmCopy'
import { PopoverDialog } from '../../ui/PopoverDialog'
import { Sheet } from '../../ui/Sheet'
import { useEscapeCapture } from '../../ui/useEscapeCapture'
import { useLatest } from '../../ui/useLatest'
import type { FactPatch } from './useFactWrite'

/** How an editor's body reports what was typed and ends the edit. */
export interface FactEdit {
  /** Reports the draft a dismissal saves; null while there is nothing to save. */
  onDraft: (patch: FactPatch | null) => void
  /** Saves `patch`, or the draft without one, and closes. */
  done: (patch?: FactPatch) => void
  /**
   * Sets a check Enter runs before it ends the edit; true keeps the editor open, for a body
   * that says why what was typed cannot be saved yet. Null clears it.
   */
  holdEnter: (hold: (() => boolean) | null) => void
}

export interface FactEditorProps {
  /** The fact's label: the dialog's name and the sheet's title. */
  label: string
  triggerRef: RefObject<HTMLElement | null>
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  /** The stored values, so a draft that changes none of them writes nothing. */
  stored: FactPatch
  /** The tune has left, such as deleted on another device: close with nothing saved. A
   * surface the page takes away with the tune can leave it out. */
  gone?: boolean
  onCommit: (patch: FactPatch) => void
  /** The body, which reads its `FactEdit` from `useFactEdit`. */
  children: ReactNode
}

const FactEditContext = createContext<FactEdit | null>(null)

/** The open editor's `FactEdit`, for the body inside it. */
// eslint-disable-next-line react-refresh/only-export-components
export function useFactEdit(): FactEdit {
  const edit = useContext(FactEditContext)
  if (!edit) throw new Error('useFactEdit needs a FactEditor')
  return edit
}

const sameValue = (a: unknown, b: unknown): boolean =>
  typeof a === 'string' && typeof b === 'string'
    ? a.trim() === b.trim()
    : JSON.stringify(a) === JSON.stringify(b)

function changed(draft: FactPatch, stored: FactPatch): boolean {
  return (Object.keys(draft) as (keyof FactPatch)[]).some(
    (key) => !sameValue(draft[key], stored[key]),
  )
}

/** A field that takes typed text, where Enter means the musician is done typing. */
const isTextEntry = (target: EventTarget): boolean =>
  target instanceof HTMLInputElement && ['text', 'search', ''].includes(target.type)

/**
 * The surface an in-place fact editor opens in: a part-height sheet on the phone frame, a
 * popover at its row elsewhere. Every way the edit ends saves the draft, so typed text survives
 * Enter, a tap outside, Done, a swipe down, or the editor going away with the page; only Escape
 * discards it.
 */
export function FactEditor({
  label,
  triggerRef,
  isOpen,
  onOpenChange,
  stored,
  gone = false,
  onCommit,
  children,
}: FactEditorProps) {
  const frame = useFrame()
  const body = useRef<HTMLDivElement>(null)
  const open = isOpen && !gone
  const draft = useRef<FactPatch | null>(null)
  const enterHold = useRef<(() => boolean) | null>(null)
  // Set once the edit has ended, so a close that follows a save or Escape saves nothing more.
  const ended = useRef(false)
  const latest = useLatest({ stored, gone, onCommit })

  const save = useCallback(
    (patch: FactPatch | null) => {
      if (ended.current) return
      ended.current = true
      const { stored: now, gone: left, onCommit: commit } = latest.current
      if (!left && patch && changed(patch, now)) commit(patch)
    },
    [latest],
  )
  const closeRef = useLatest(onOpenChange)

  useEffect(() => {
    if (isOpen && gone) onOpenChange(false)
  }, [isOpen, gone, onOpenChange])

  useEffect(() => {
    if (!open) return
    ended.current = false
    draft.current = null
    // A close or unmount with no dismissal, such as browser Back, still saves what was typed.
    return () => save(draft.current)
  }, [open, save])

  // Heard at window capture, ahead of the popover or sheet, which would close on Escape through
  // the same `onOpenChange(false)` as any other dismissal and so save the draft.
  useEscapeCapture(
    () => {
      ended.current = true
      onOpenChange(false)
    },
    {
      enabled: open,
      // A menu or picker opened from the body sits outside this dialog and takes its own Escape.
      // Focus left on the body, such as after a press on the surface's padding, is still here.
      when: (event) =>
        !event.defaultPrevented &&
        (event.target === document.body ||
          (event.target instanceof Node &&
            (body.current?.closest('[role="dialog"]')?.contains(event.target) ?? false))),
    },
  )

  const edit = useMemo<FactEdit>(
    () => ({
      onDraft: (patch) => {
        draft.current = patch
      },
      done: (patch) => {
        save(patch ?? draft.current)
        closeRef.current(false)
      },
      holdEnter: (hold) => {
        enterHold.current = hold
      },
    }),
    [save, closeRef],
  )

  const change = (next: boolean) => {
    if (!next && open) save(draft.current)
    onOpenChange(next)
  }

  const content = (
    <div
      ref={body}
      onKeyDownCapture={(event) => {
        // A suggestion the keyboard has focused takes Enter as its pick, which saves on its own.
        if (
          event.key !== 'Enter' ||
          event.nativeEvent.isComposing ||
          !isTextEntry(event.target) ||
          (event.target as HTMLElement).getAttribute('aria-activedescendant')
        ) {
          return
        }
        event.preventDefault()
        if (enterHold.current?.()) return
        edit.done()
      }}
    >
      <FactEditContext value={edit}>{children}</FactEditContext>
    </div>
  )
  if (frame === 'phone') {
    return (
      <Sheet
        isOpen={open}
        onOpenChange={change}
        title={label}
        height="part"
        primary={{ label: DONE, onPress: () => change(false) }}
        cancel={null}
      >
        {content}
      </Sheet>
    )
  }
  return (
    <PopoverDialog label={label} triggerRef={triggerRef} isOpen={open} onOpenChange={change}>
      {content}
    </PopoverDialog>
  )
}
