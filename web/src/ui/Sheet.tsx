import type { LucideIcon } from 'lucide-react'
import {
  AnimatePresence,
  animate,
  motion,
  useDragControls,
  useIsPresent,
  useMotionValue,
  useReducedMotionConfig,
  useTransform,
  type MotionValue,
  type PanInfo,
} from 'motion/react'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { CANCEL } from './confirmCopy'
import { useLatest } from './useLatest'
import { useStampedDensity } from '../platform/density'
import { DURATION, EASE, SPRING } from '../theme/motion'
import { Button } from './Button'
import { PointerOverlay } from './PointerOverlay'
import { recede } from './recede'
import { growScale, originBox, releaseTarget, scrim, SHEET } from './sheetGeometry'
import { useOverlayClaim } from './overlayClaim'
import { clamp } from '../math'

const MotionModalOverlay = motion.create(ModalOverlay)
const MotionModal = motion.create(Modal)

export interface SheetPrimary {
  label: string
  icon?: LucideIcon
  onPress: () => void
  isDisabled?: boolean
}

export interface SheetProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  /** The header title and the dialog's accessible name. */
  title: string
  /** Touch only: open at part height, draggable to full, or open full for a long form. */
  height?: 'part' | 'full'
  /** Refuse backdrop tap, drag down, and Escape, so typed work survives; Cancel still closes. */
  locked?: boolean
  /**
   * While locked, a device back press still asks `onOpenChange` to close, for a sheet that asks
   * before it loses work rather than refusing.
   */
  asksOnBack?: boolean
  cancelLabel?: string
  /** The id of the element that describes the dialog, for assistive tech. */
  describedBy?: string
  primary?: SheetPrimary
  /**
   * Takes Cancel's place, for a sheet whose choices apply at once, such as Reset. Null leaves
   * the place empty, for such a sheet with nothing to put there: Cancel would claim to undo.
   */
  leading?: SheetPrimary | null
  /** Runs once the sheet has finished closing and left the page. */
  onClosed?: () => void
  /** The control the sheet grows out of and closes back into, such as the Record disc. */
  origin?: () => Element | null
  children: ReactNode
}

/**
 * A bottom sheet with a grabber on touch and a centered dialog on pointer, headed by Cancel,
 * the title, and an optional primary. Focus returns to the opener on close.
 */
export function Sheet(props: SheetProps) {
  const density = useStampedDensity()
  return (
    <AnimatePresence onExitComplete={props.onClosed}>
      {props.isOpen &&
        (density === 'touch' ? (
          <TouchSheet key="touch" {...props} />
        ) : (
          <PointerDialog key="pointer" {...props} />
        ))}
    </AnimatePresence>
  )
}

function subscribeResize(onChange: () => void): () => void {
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}

function useViewport(): { width: number; height: number } {
  const width = useSyncExternalStore(subscribeResize, () => window.innerWidth)
  const height = useSyncExternalStore(subscribeResize, () => window.innerHeight)
  return { width, height }
}

function isTextInput(target: EventTarget): boolean {
  return (
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !==
      null
  )
}

function SheetHeader({
  title,
  cancelLabel,
  onCancel,
  primary,
  leading,
}: {
  title: string
  cancelLabel: string
  onCancel: () => void
  primary?: SheetPrimary
  leading?: SheetPrimary | null
}) {
  return (
    // Side columns grow equally so the title stays centered; it wraps rather than clips. The body
    // takes 4px of the gap below, so the ring of a field at its top is not clipped.
    <header className="grid grid-cols-[minmax(max-content,1fr)_minmax(0,auto)_minmax(max-content,1fr)] items-center gap-2 px-2 pt-2 pb-1">
      <div className="justify-self-start">
        {leading === null ? null : leading ? (
          <Button
            label={leading.label}
            icon={leading.icon}
            onPress={leading.onPress}
            isDisabled={leading.isDisabled}
          />
        ) : (
          <Button label={cancelLabel} onPress={onCancel} />
        )}
      </div>
      <Heading slot="title" className="t-heading text-center break-words">
        {title}
      </Heading>
      <div className="justify-self-end">
        {primary && (
          <Button
            variant="primary"
            label={primary.label}
            icon={primary.icon}
            onPress={primary.onPress}
            isDisabled={primary.isDisabled}
          />
        )}
      </div>
    </header>
  )
}

function PointerDialog({
  onOpenChange,
  title,
  locked = false,
  asksOnBack = false,
  cancelLabel = CANCEL,
  describedBy,
  primary,
  leading,
  origin,
  children,
}: SheetProps) {
  return (
    <PointerOverlay
      origin={origin}
      onOpenChange={onOpenChange}
      isDismissable={!locked}
      isKeyboardDismissDisabled={locked}
      backDismissable={!locked || asksOnBack}
      className="bg-ground flex max-h-full max-w-full flex-col overflow-hidden rounded-(--radius-surface) shadow-(--shadow-float)"
      style={{ width: SHEET.width }}
    >
      <Dialog aria-describedby={describedBy} className="flex max-h-full min-h-0 flex-col">
        <SheetHeader
          title={title}
          cancelLabel={cancelLabel}
          onCancel={() => onOpenChange(false)}
          primary={primary}
          leading={leading}
        />
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-4">{children}</div>
      </Dialog>
    </PointerOverlay>
  )
}

/** Drives the page's recede from `y`, 0 (full) to `closedY` (none), while this sheet shows. */
function useRecede(y: MotionValue<number>, closedY: number): void {
  useLayoutEffect(() => {
    const recession = recede()
    const update = (value: number) => recession.set(1 - clamp(value / closedY, 0, 1))
    update(y.get())
    const stop = y.on('change', update)
    return () => {
      stop()
      recession.release()
    }
  }, [y, closedY])
}

/** Whether the element's content overflows it, so it scrolls instead of dragging the sheet. */
function useOverflows(element: HTMLElement | null): boolean {
  const [overflows, setOverflows] = useState(false)
  useLayoutEffect(() => {
    if (!element) return
    const measure = () => setOverflows(element.scrollHeight > element.clientHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    // The content's one wrapper grows with whatever it holds.
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    return () => observer.disconnect()
  }, [element])
  return overflows
}

function TouchSheet({
  onOpenChange,
  title,
  height = 'part',
  locked = false,
  asksOnBack = false,
  cancelLabel = CANCEL,
  describedBy,
  primary,
  leading,
  origin,
  children,
}: SheetProps) {
  useOverlayClaim({
    coversShell: true,
    close: () => onOpenChange(false),
    dismissable: !locked || asksOnBack,
  })
  const viewport = useViewport()
  const reduceMotion = useReducedMotionConfig() ?? false
  // Read once as it opens, so it closes back into the place it came from. The sheet rises as
  // wide as the control and widens to the window.
  const [box] = useState(() => (reduceMotion ? null : originBox(origin)))
  const grow = box && {
    from: growScale(box, viewport.width),
    transformOrigin: `${box.left + box.width / 2}px 0px`,
  }
  // `y` is the sheet's offset from full height: 0 is full, closedY is off screen.
  const closedY = viewport.height - SHEET.topMargin
  const openY = height === 'part' ? closedY - viewport.height * SHEET.partRatio : 0
  const detents = height === 'part' ? [0, openY] : [0]
  const y = useMotionValue(reduceMotion ? openY : closedY)
  const backdrop = useTransform(y, (value) => scrim(1 - clamp(value / closedY, 0, 1)))
  const dragControls = useDragControls()
  const [content, setContent] = useState<HTMLDivElement | null>(null)
  const contentScrolls = useOverflows(content)
  useRecede(y, closedY)

  // Where the sheet rests, so a new window size, such as a rotation, keeps it there.
  const detent = useRef<'part' | 'full'>(height)
  const settle = (target: number, velocity = 0) => {
    detent.current = target === 0 ? 'full' : 'part'
    if (reduceMotion) y.jump(target)
    else animate(y, target, { ...SPRING, velocity })
  }

  useEffect(() => {
    const target = detent.current === 'full' ? 0 : openY
    if (reduceMotion) y.jump(target)
    else animate(y, target, { duration: DURATION.long, ease: EASE })
  }, [y, openY, reduceMotion])

  // A parent may refuse to close; a sheet still here once it has had time to answer a closing
  // release goes back up. An answer after an await would otherwise spring up before it exits.
  const isPresent = useIsPresent()
  const [closeAsks, setCloseAsks] = useState(0)
  const settleRef = useLatest(settle)
  const reopenAt = useLatest(() => releaseTarget(y.get(), 0, detents))
  useEffect(() => {
    if (closeAsks === 0 || !isPresent) return
    const timer = setTimeout(() => settleRef.current(reopenAt.current()), SHEET.closeAnswerMs)
    return () => clearTimeout(timer)
  }, [closeAsks, isPresent, settleRef, reopenAt])

  const startDrag = (event: ReactPointerEvent) => {
    if (isTextInput(event.target)) return
    if (contentScrolls && content?.contains(event.target as Node)) return
    dragControls.start(event)
  }

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const stops = locked ? detents : [...detents, closedY]
    const target = releaseTarget(y.get(), info.velocity.y, stops)
    if (target !== closedY) {
      settle(target, info.velocity.y)
      return
    }
    onOpenChange(false)
    setCloseAsks((count) => count + 1)
  }

  const fade = { duration: DURATION.base, ease: EASE }
  return (
    <MotionModalOverlay
      isOpen
      onOpenChange={onOpenChange}
      isDismissable={!locked}
      isKeyboardDismissDisabled={locked}
      data-sheet-scrim
      className="fixed inset-0 z-50"
      style={{ backgroundColor: backdrop }}
      // Reduced motion trades the slide for a cross-fade of the whole overlay.
      initial={reduceMotion ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      exit={reduceMotion ? { opacity: 0, transition: fade } : undefined}
      transition={fade}
    >
      <MotionModal
        className="bg-ground absolute inset-x-0 rounded-t-(--radius-surface) shadow-(--shadow-float) after:absolute after:inset-x-0 after:top-full after:h-16 after:bg-inherit"
        style={{
          y,
          top: SHEET.topMargin,
          height: closedY,
          transformOrigin: grow?.transformOrigin,
        }}
        initial={grow ? { scaleX: grow.from } : undefined}
        animate={
          grow ? { scaleX: 1, transition: { duration: DURATION.long, ease: EASE } } : undefined
        }
        exit={
          reduceMotion
            ? undefined
            : { y: closedY, ...(grow && { scaleX: grow.from }), transition: fade }
        }
        drag="y"
        dragListener={false}
        dragControls={dragControls}
        dragMomentum={false}
        dragConstraints={{ top: 0, bottom: locked ? Math.max(...detents) : closedY }}
        dragElastic={{ top: 0.05, bottom: locked ? SHEET.lockedElastic : 0 }}
        onDragEnd={onDragEnd}
      >
        <Dialog aria-describedby={describedBy} className="h-full">
          <div
            className="flex h-full flex-col pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]"
            onPointerDown={startDrag}
          >
            <div className="flex touch-none justify-center pt-2" aria-hidden>
              <div className="bg-silver h-1.5 w-10 rounded-(--radius-capsule)" />
            </div>
            <div className="touch-none">
              <SheetHeader
                title={title}
                cancelLabel={cancelLabel}
                onCancel={() => onOpenChange(false)}
                primary={primary}
                leading={leading}
              />
            </div>
            <div
              ref={setContent}
              data-sheet-content
              className={`min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-[max(1rem,env(safe-area-inset-bottom))] ${
                contentScrolls ? 'touch-pan-y' : 'touch-none'
              }`}
            >
              <div>{children}</div>
            </div>
          </div>
        </Dialog>
      </MotionModal>
    </MotionModalOverlay>
  )
}
