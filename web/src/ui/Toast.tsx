import { useReducedMotionConfig } from 'motion/react'
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { UNDO } from './toastCopy'
import { useLatest } from './useLatest'
import { Button } from './Button'

/** How long a toast stays when nothing holds it open. */
export const TOAST_MS = 8000
export { UNDO } from './toastCopy'

interface ToastState {
  id: number
  message: string
  undo?: () => void
}

interface ToastApi {
  show: (message: string, undo?: () => void) => void
}

const ToastContext = createContext<ToastApi | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastApi {
  const api = use(ToastContext)
  if (!api) throw new Error('useToast needs a ToastProvider')
  return api
}

export interface ToastClock {
  now: () => number
  setTimeout: (callback: () => void, ms: number) => number
  clearTimeout: (handle: number) => void
}

// Each call looks the global up again so fake timers installed after import still apply.
const REAL_CLOCK: ToastClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => window.clearTimeout(handle),
}

/**
 * Owns the one toast on screen. A new toast replaces the old. The countdown holds while the
 * toast has keyboard focus or the pointer is over it, so Undo stays reachable.
 */
export function ToastProvider({
  children,
  clock = REAL_CLOCK,
}: {
  children: ReactNode
  clock?: ToastClock
}) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const [leaving, setLeaving] = useState(false)
  const reduceMotion = useReducedMotionConfig() ?? false
  const clockRef = useLatest(clock)
  const nextId = useRef(0)
  const timer = useRef<{ handle: number; startedAt: number; remaining: number } | null>(null)
  const held = useRef({ focus: false, pointer: false })

  const stop = useCallback(() => {
    if (!timer.current) return
    clockRef.current.clearTimeout(timer.current.handle)
    timer.current = null
  }, [clockRef])

  const reduceMotionRef = useLatest(reduceMotion)
  const toastRef = useRef<HTMLDivElement>(null)

  const returnFocusTo = useRef<Element | null>(null)
  // Focus inside a toast that goes away would fall to <body>; hand it back to where it came from.
  const restoreFocus = useCallback(() => {
    const el = toastRef.current
    if (!el?.contains(document.activeElement)) return
    const target = returnFocusTo.current
    if (target instanceof HTMLElement && target.isConnected) target.focus()
    else (document.activeElement as HTMLElement).blur()
    returnFocusTo.current = null
  }, [])

  const dismiss = useCallback(() => {
    stop()
    restoreFocus()
    if (reduceMotionRef.current) setToast(null)
    else setLeaving(true)
  }, [stop, reduceMotionRef, restoreFocus])

  const start = useCallback(
    (ms: number) => {
      stop()
      const { now, setTimeout } = clockRef.current
      timer.current = { handle: setTimeout(dismiss, ms), startedAt: now(), remaining: ms }
    },
    [stop, dismiss, clockRef],
  )

  const hold = useCallback(
    (kind: 'focus' | 'pointer', on: boolean) => {
      const wasHeld = held.current.focus || held.current.pointer
      held.current[kind] = on
      const isHeld = held.current.focus || held.current.pointer
      if (isHeld === wasHeld) return
      if (isHeld) {
        const current = timer.current
        if (!current) return
        const remaining = Math.max(
          0,
          current.remaining - (clockRef.current.now() - current.startedAt),
        )
        stop()
        timer.current = { handle: -1, startedAt: 0, remaining }
      } else if (timer.current) {
        start(timer.current.remaining)
      }
    },
    [start, stop, clockRef],
  )

  const show = useCallback(
    (message: string, undo?: () => void) => {
      restoreFocus()
      held.current = { focus: false, pointer: false }
      nextId.current += 1
      setLeaving(false)
      setToast({ id: nextId.current, message, undo })
      start(TOAST_MS)
    },
    [start, restoreFocus],
  )

  useEffect(() => stop, [stop])

  // Unmounts once the fade ends. Reading the animations also covers a toast dismissed before
  // its fade began, which would otherwise never fire a transition event.
  useEffect(() => {
    const el = toastRef.current
    if (!leaving || !el) return
    let cancelled = false
    const id = toast?.id
    void Promise.allSettled(el.getAnimations().map((animation) => animation.finished)).then(() => {
      if (!cancelled) setToast((current) => (current?.id === id ? null : current))
    })
    return () => {
      cancelled = true
    }
  }, [leaving, toast?.id])

  const api = useMemo(() => ({ show }), [show])

  return (
    <ToastContext value={api}>
      {children}
      {/* Portaled above the modal layer; the top-layer marker keeps it out of aria-hidden. */}
      {createPortal(
        <div
          role="status"
          data-react-aria-top-layer
          className="pointer-events-none fixed z-[60] flex justify-center px-4"
          style={{
            left: 'var(--toast-left, 0px)',
            right: 'var(--toast-right, 0px)',
            bottom: 'var(--toast-bottom, calc(1rem + env(safe-area-inset-bottom)))',
          }}
        >
          {toast && (
            <div
              key={toast.id}
              ref={toastRef}
              data-leaving={leaving || undefined}
              onPointerEnter={() => hold('pointer', true)}
              onPointerLeave={() => hold('pointer', false)}
              onFocus={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  returnFocusTo.current = event.relatedTarget
                }
                hold('focus', true)
              }}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) hold('focus', false)
              }}
              className={`bg-ground text-ink t-body pointer-events-auto flex max-w-full items-center gap-3 rounded-(--radius-surface) py-2 ps-4 pe-2 shadow-(--shadow-float) ${
                reduceMotion
                  ? ''
                  : 'transition-[opacity,translate] duration-(--dur-base) ease-(--ease) data-[leaving]:opacity-0 starting:translate-y-4 starting:opacity-0'
              }`}
            >
              <span>{toast.message}</span>
              {toast.undo && (
                <Button
                  variant="plain"
                  label={UNDO}
                  onPress={() => {
                    toast.undo?.()
                    dismiss()
                  }}
                />
              )}
            </div>
          )}
        </div>,
        document.body,
      )}
    </ToastContext>
  )
}
