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
import { CANCEL, DONE } from '../confirmCopy'
import { PopoverDialog } from '../PopoverDialog'
import { Sheet, type SheetProps } from '../Sheet'
import { useEscapeCapture } from '../useEscapeCapture'
import { useLatest } from '../useLatest'

/** How an editor's body reports what was typed and ends the edit. */
export interface AttributeEdit<P extends object = object> {
  /** Reports the draft a dismissal saves; null while there is nothing to save. */
  onDraft: (patch: P | null) => void
  /** Saves `patch`, or the draft without one, and closes. */
  done: (patch?: P) => void
  /** Sets what Enter in a text field of the body does; null, the default, does nothing. */
  onEnter: (action: (() => void) | null) => void
}

/** The surface and its dismissals, whichever way the edit saves. */
export interface AttributeEditorFrame {
  /** The attribute's label: the dialog's name and the sheet's title. */
  label: string
  triggerRef: RefObject<HTMLElement | null>
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  /** The tune has left, such as deleted on another device: close with nothing saved. A
   * surface the page takes away with the tune can leave it out. */
  gone?: boolean
  /** Opens as a sheet on every frame, for an editor too large for a popover. */
  forceSheet?: boolean
  /**
   * Adds a Cancel button beside Done, for an editor that stages several picks. It acts as
   * Escape does: back out of a step, else close with nothing saved. Sheet only.
   */
  cancelable?: boolean
  /**
   * A step of its own the body shows: a Back control in the sheet's header, and `title` in
   * place of `label`. Escape goes back while it is set, and the edit goes on. `height` sets a
   * touch sheet's height while the step shows, part height when left out.
   */
  step?: { title?: string; back: () => void; height?: SheetProps['height'] }
  /** The body, which reads its `AttributeEdit` from `useAttributeEdit`. */
  children: ReactNode
}

/** A dismissal saves the draft the body reports, when it changes a stored value. */
export interface PatchSave<P extends object> {
  /** The stored values, so a draft that changes none of them writes nothing. */
  stored: P
  onCommit: (patch: P) => void
}

/** A dismissal saves what the body holds itself, for a body with more than a patch to save. */
export interface HeldSave {
  /** True while the body holds a change. */
  dirty: boolean
  onSave: () => void
}

export type AttributeEditorProps<P extends object> = AttributeEditorFrame &
  (PatchSave<P> | HeldSave)

const AttributeEditContext = createContext<AttributeEdit<never> | null>(null)

/** The open editor's `AttributeEdit`, for the body inside it. */
// eslint-disable-next-line react-refresh/only-export-components
export function useAttributeEdit<P extends object = object>(): AttributeEdit<P> {
  const edit = useContext(AttributeEditContext)
  if (!edit) throw new Error('useAttributeEdit needs an AttributeEditor')
  return edit as AttributeEdit<P>
}

const sameValue = (a: unknown, b: unknown): boolean =>
  typeof a === 'string' && typeof b === 'string'
    ? a.trim() === b.trim()
    : JSON.stringify(a) === JSON.stringify(b)

function changed<P extends object>(draft: P, stored: P): boolean {
  return (Object.keys(draft) as (keyof P)[]).some((key) => !sameValue(draft[key], stored[key]))
}

/** A search holding text, whose own Escape empties it before the editor would close. */
const isFilledSearch = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement && target.type === 'search' && target.value !== ''

/**
 * Has Enter in a text field of the body run `action`, or end the edit, saving the draft, without
 * one. Without this hook Enter there does nothing.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useEnterKey(action?: () => void): void {
  const edit = useAttributeEdit()
  const actionRef = useLatest(action)
  useEffect(() => {
    edit.onEnter(() => (actionRef.current ?? edit.done)())
    return () => edit.onEnter(null)
  }, [edit, actionRef])
}

/** A field that takes typed text, where Enter means the musician is done typing. */
const isTextEntry = (target: EventTarget): boolean =>
  target instanceof HTMLInputElement && ['text', 'search', ''].includes(target.type)

/**
 * The surface an in-place attribute editor opens in: a part-height sheet on the phone frame or
 * when forced, a popover at its row elsewhere. Every way the edit ends saves the draft, so typed
 * text survives Enter, a tap outside, Done, a swipe down, or the editor going away with the
 * page; only Escape, and Cancel where shown, discards it.
 */
export function AttributeEditor<P extends object>(props: AttributeEditorProps<P>) {
  const {
    label,
    triggerRef,
    isOpen,
    onOpenChange,
    gone = false,
    forceSheet = false,
    cancelable = false,
    step,
    children,
  } = props
  const frame = useFrame()
  const body = useRef<HTMLDivElement>(null)
  const open = isOpen && !gone
  const draft = useRef<P | null>(null)
  const enterAction = useRef<(() => void) | null>(null)
  // Set once the edit has ended, so a close that follows a save or Escape saves nothing more.
  const ended = useRef(false)
  const latest = useLatest(props)

  const save = useCallback(
    (patch: P | null) => {
      if (ended.current) return
      ended.current = true
      const now = latest.current
      if (now.gone) return
      if ('dirty' in now) {
        if (now.dirty) now.onSave()
      } else if (patch && changed(patch, now.stored)) {
        now.onCommit(patch)
      }
    },
    [latest],
  )
  const closeRef = useLatest(onOpenChange)
  const backRef = useLatest(step?.back)

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

  // Back out of a step, else end the edit with nothing saved.
  const cancel = useLatest(() => {
    const back = backRef.current
    if (back) {
      back()
      return
    }
    ended.current = true
    onOpenChange(false)
  })

  // Heard at window capture, ahead of the popover or sheet, which would close on Escape through
  // the same `onOpenChange(false)` as any other dismissal and so save the draft.
  useEscapeCapture(() => cancel.current(), {
    enabled: open,
    // A menu or picker opened from the body sits outside this dialog and takes its own Escape.
    // Focus left on the body, such as after a press on the surface's padding, is still here.
    when: (event) =>
      !event.defaultPrevented &&
      !isFilledSearch(event.target) &&
      (event.target === document.body ||
        (event.target instanceof Node &&
          (body.current?.closest('[role="dialog"]')?.contains(event.target) ?? false))),
  })

  const edit = useMemo<AttributeEdit<P>>(
    () => ({
      onDraft: (patch) => {
        draft.current = patch
      },
      done: (patch) => {
        save(patch ?? draft.current)
        closeRef.current(false)
      },
      onEnter: (action) => {
        enterAction.current = action
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
        enterAction.current?.()
      }}
    >
      <AttributeEditContext value={edit as AttributeEdit<never>}>{children}</AttributeEditContext>
    </div>
  )
  if (frame === 'phone' || forceSheet) {
    return (
      <Sheet
        isOpen={open}
        onOpenChange={change}
        title={step?.title ?? label}
        onBack={step?.back}
        height={step?.height ?? 'part'}
        primary={{ label: DONE, onPress: () => change(false) }}
        cancel={cancelable ? { label: CANCEL, onPress: () => cancel.current() } : null}
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
