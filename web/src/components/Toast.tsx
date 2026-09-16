import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { TOAST_MS, ToastContext, type ToastOptions } from './toastContext'

interface Current extends ToastOptions {
  id: number
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong'
}

/** The longest transition on the element in milliseconds, so the exit timing lives only in CSS. */
function transitionMs(element: HTMLElement | null): number {
  if (!element) return 0
  const style = getComputedStyle(element)
  const parse = (value: string) =>
    value.split(',').map((part) => {
      const trimmed = part.trim()
      const number = parseFloat(trimmed)
      if (Number.isNaN(number)) return 0
      return trimmed.endsWith('ms') ? number : number * 1000
    })
  const durations = parse(style.transitionDuration)
  const delays = parse(style.transitionDelay)
  return Math.max(0, ...durations.map((duration, index) => duration + (delays[index] ?? 0)))
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Current | null>(null)
  const [visible, setVisible] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const paused = hovered || focused

  const show = useCallback((options: ToastOptions) => {
    setCurrent((previous) => ({ ...options, id: (previous?.id ?? 0) + 1 }))
    setVisible(true)
  }, [])

  const releaseFocus = useCallback(() => {
    document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true })
    setFocused(false)
  }, [])

  const hide = useCallback(() => {
    // The toast turns inert as it hides, so focus inside it would be stranded.
    if (boxRef.current?.contains(document.activeElement)) releaseFocus()
    setVisible(false)
    setHovered(false)
    setFocused(false)
  }, [releaseFocus])

  // A focused button that unmounts sends no blur, so the pause on focus would never lift.
  const undoRef = useRef<HTMLButtonElement | null>(null)
  const undoButtonRef = useCallback(
    (node: HTMLButtonElement | null) => {
      if (node === null && undoRef.current && document.activeElement === undoRef.current) {
        releaseFocus()
      }
      undoRef.current = node
    },
    [releaseFocus],
  )

  useEffect(() => {
    if (!visible || paused) return
    const timer = setTimeout(hide, TOAST_MS)
    return () => clearTimeout(timer)
  }, [visible, paused, current?.id, hide])

  useEffect(() => {
    if (visible) return
    const timer = setTimeout(() => setCurrent(null), transitionMs(boxRef.current))
    return () => clearTimeout(timer)
  }, [visible])

  const api = useMemo(() => ({ show }), [show])

  const undo = () => {
    const action = current?.undo
    if (!action) return
    // Dropping the undo before it runs keeps a double tap from undoing twice.
    setCurrent((previous) => previous && { id: previous.id, message: previous.message })
    hide()
    action().catch((error: unknown) => show({ message: messageFor(error) }))
  }

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        ref={boxRef}
        data-state={visible ? 'open' : 'closed'}
        className={`rounded-box bg-base-content text-base-100 fixed right-20 bottom-[calc(5rem+env(safe-area-inset-bottom)+var(--player-dock-height,0px))] left-4 z-30 flex max-w-md items-center gap-2 py-1 pr-1 pl-4 shadow-lg transition-[opacity,translate] duration-(--select-toast-duration) ease-(--ease-emphasized) ${
          visible ? '' : 'pointer-events-none opacity-0 motion-safe:translate-y-4'
        }`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
        }}
      >
        {/* The live region stays outside the inert subtree so it is announced as its text changes. */}
        <p role="status" className="flex-1 text-sm">
          {current?.message}
        </p>
        <div inert={!visible} className="flex items-center gap-2">
          {current?.undo ? (
            <button
              ref={undoButtonRef}
              type="button"
              className="btn btn-ghost btn-sm text-warning min-h-11"
              onClick={undo}
            >
              Undo
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-circle min-h-11 min-w-11"
            aria-label="Dismiss"
            onClick={hide}
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      </div>
    </ToastContext.Provider>
  )
}
