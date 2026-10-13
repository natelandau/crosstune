import { X, type LucideIcon } from 'lucide-react'
import {
  AnimatePresence,
  animate,
  motion,
  useDragControls,
  useIsPresent,
  useMotionValue,
  useReducedMotionConfig,
  useTransform,
  type MotionStyle,
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
import { CANCEL, CLOSE } from './confirmCopy'
import { useLatest } from './useLatest'
import { useStampedDensity } from '../platform/density'
import { DURATION, EASE, SPRING } from '../theme/motion'
import { Button } from './Button'
import { TONE_VARIANT, type ActionTone } from './toneVariant'
import { PointerOverlay } from './PointerOverlay'
import { recede } from './recede'
import { growScale, originBox, releaseTarget, scrim, SHEET } from './sheetGeometry'
import { useOverlayClaim } from './overlayClaim'
import { clamp } from '../math'

const MotionModalOverlay = motion.create(ModalOverlay)
const MotionModal = motion.create(Modal)

export interface SheetAction {
  label: string
  icon?: LucideIcon
  onPress: () => void
  isDisabled?: boolean
}

export interface SheetPrimary extends SheetAction {
  tone?: ActionTone
}

export interface SheetCancel {
  label?: string
  /** Closes the sheet by default. */
  onPress?: () => void
  isDisabled?: boolean
}

export interface SheetProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  /** The header title and the dialog's accessible name. Leave out when `labelledBy` names it. */
  title?: string
  /**
   * The id of a heading in the content that names the dialog, for a sheet whose content opens on
   * its own headline. The header then shows no title and keeps its close button in place.
   */
  labelledBy?: string
  /**
   * Touch only: open at part height, draggable to full; open full for a long form; or fit the
   * content, up to part height, for a short question such as a confirmation.
   */
  height?: 'part' | 'full' | 'fit'
  /** Refuse backdrop tap, drag down, and Escape, so typed work survives; Cancel still closes. */
  locked?: boolean
  /**
   * While locked, a device back press still asks `onOpenChange` to close, for a sheet that asks
   * before it loses work rather than refusing.
   */
  asksOnBack?: boolean
  /** The id of the element that describes the dialog, for assistive tech. */
  describedBy?: string
  /** The footer's trailing, filled action. */
  primary?: SheetPrimary
  /**
   * Cancel, beside the primary. Null leaves it out, for a sheet whose choices apply at once:
   * Cancel would claim to undo them.
   */
  cancel?: SheetCancel | null
  /**
   * Keeps the header's close button beside footer actions, for a sheet whose actions all lead on
   * somewhere and none simply closes it.
   */
  closeButton?: boolean
  /** Makes the primary a full-width, taller button, for a sheet that leads to one action. */
  primaryLarge?: boolean
  /**
   * The accessory, actions, and footnote end the scrolling content instead of pinning to the
   * sheet's foot, so the sheet reads as one page.
   */
  inlineActions?: boolean
  /**
   * Stacks the actions in a column: the full-width primary, then the tertiary centered beneath it
   * as plain text. Implies `primaryLarge`, and ignores `cancel`: a stacked sheet closes from its
   * header.
   */
  stackedActions?: boolean
  /** A quiet action at the footer's leading end, such as Reset or Back. */
  tertiary?: SheetAction
  /** Above the actions, such as a choice the primary acts on. */
  accessory?: ReactNode
  /** Below the actions, such as the terms of a sale. */
  footnote?: ReactNode
  /** Runs once the sheet has finished closing and left the page. */
  onClosed?: () => void
  /** The control the sheet grows out of and closes back into, such as the Record disc. */
  origin?: () => Element | null
  children: ReactNode
}

/**
 * A bottom sheet with a grabber on touch and a centered dialog on pointer: the title heads it
 * and its actions sit in a footer, the primary trailing. A sheet with no actions takes a close
 * button in its header instead. Focus returns to the opener on close.
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

/** Whether the sheet has footer actions; one without shows a close button in its header. */
function hasActions({
  primary,
  cancel,
  tertiary,
}: Pick<SheetProps, 'primary' | 'cancel' | 'tertiary'>): boolean {
  return primary !== undefined || tertiary !== undefined || cancel !== null
}

/** Whether the sheet pins anything to its foot: actions, or content beside them. */
function hasFooter(props: SheetProps): boolean {
  return hasActions(props) || Boolean(props.accessory) || Boolean(props.footnote)
}

function SheetHeader({
  title,
  edge,
  onClose,
}: {
  title?: string
  /** Content has scrolled up under the header, so a hairline sets it apart. */
  edge: boolean
  /** Shown as a close button, for a sheet with no footer. */
  onClose?: () => void
}) {
  return (
    // The body takes 4px of the gap below, so the ring of a field at its top is not clipped.
    <header
      className={`flex min-h-(--target-control) items-center gap-3 border-b px-4 pt-3 pb-2 transition-colors duration-(--dur-short) ${
        edge ? 'border-hairline' : 'border-transparent'
      }`}
    >
      {title === undefined ? (
        <div className="min-w-0 flex-1" />
      ) : (
        <Heading slot="title" className="t-heading min-w-0 flex-1 break-words">
          {title}
        </Heading>
      )}
      {onClose && <Button iconOnly icon={X} label={CLOSE} onPress={onClose} />}
    </header>
  )
}

/**
 * The sheet's actions: a quiet tertiary leading, then Cancel and the filled primary trailing.
 * On touch, Cancel and the primary split the width into two equal targets, and a lone action
 * runs full width. Stacked, they form a column with no Cancel.
 */
function SheetActions({
  primary,
  primaryLarge = false,
  stacked = false,
  cancel,
  tertiary,
  accessory,
  footnote,
  onClose,
  touch,
}: {
  primary?: SheetPrimary
  primaryLarge?: boolean
  stacked?: boolean
  cancel?: SheetCancel | null
  tertiary?: SheetAction
  accessory?: ReactNode
  footnote?: ReactNode
  onClose: () => void
  touch: boolean
}) {
  // A wrapper sizes each button: equal shares on touch, a floor on pointer so a short label such
  // as OK still reads as a button.
  const slot = primaryLarge ? 'flex w-full' : touch ? 'flex min-w-0 flex-1' : 'flex min-w-20'
  const actions = hasActions({ primary, cancel, tertiary })
  if (stacked) {
    return (
      <>
        {accessory}
        {actions && (
          <div className="flex flex-col items-stretch gap-1">
            {primary && (
              <Button
                variant={primary.tone ? TONE_VARIANT[primary.tone] : 'primary'}
                fullWidth
                large
                label={primary.label}
                icon={primary.icon}
                onPress={primary.onPress}
                isDisabled={primary.isDisabled}
              />
            )}
            {tertiary && (
              <div className="flex justify-center">
                <Button
                  label={tertiary.label}
                  icon={tertiary.icon}
                  onPress={tertiary.onPress}
                  isDisabled={tertiary.isDisabled}
                />
              </div>
            )}
          </div>
        )}
        {footnote}
      </>
    )
  }
  return (
    <>
      {accessory}
      {actions && (
        <div className="flex items-center gap-2">
          {tertiary && (
            <div className="me-auto flex">
              <Button
                label={tertiary.label}
                icon={tertiary.icon}
                onPress={tertiary.onPress}
                isDisabled={tertiary.isDisabled}
              />
            </div>
          )}
          {!tertiary && !touch && !primaryLarge && <div className="me-auto" />}
          {cancel !== null && (
            <div className={slot}>
              <Button
                variant="bordered"
                fullWidth
                label={cancel?.label ?? CANCEL}
                onPress={cancel?.onPress ?? onClose}
                isDisabled={cancel?.isDisabled}
              />
            </div>
          )}
          {primary && (
            <div className={slot}>
              <Button
                variant={primary.tone ? TONE_VARIANT[primary.tone] : 'primary'}
                fullWidth
                large={primaryLarge}
                label={primary.label}
                icon={primary.icon}
                onPress={primary.onPress}
                isDisabled={primary.isDisabled}
              />
            </div>
          )}
        </div>
      )}
      {footnote}
    </>
  )
}

/** The sheet's actions at the end of its scrolling content, for a sheet that reads as one page. */
function InlineActions(actions: Parameters<typeof SheetActions>[0]) {
  return (
    <div className="flex flex-col gap-3 pt-4">
      <SheetActions {...actions} />
    </div>
  )
}

/** The sheet's actions, pinned to its foot. */
function SheetFooter({
  edge,
  className = '',
  style,
  ...actions
}: Parameters<typeof SheetActions>[0] & {
  /** Content runs on under the footer, so a hairline sets it apart. */
  edge: boolean
  className?: string
  style?: MotionStyle
}) {
  return (
    <motion.footer
      className={`bg-ground flex flex-col gap-3 border-t px-4 pt-3 transition-colors duration-(--dur-short) ${
        edge ? 'border-hairline' : 'border-transparent'
      } ${className}`}
      style={style}
    >
      <SheetActions {...actions} />
    </motion.footer>
  )
}

/**
 * Where a scrolling body meets the header and footer: whether content has scrolled up under the
 * header, and whether more runs on below the footer. `covered` is how much of the body's foot a
 * raised footer hides, so content under it counts as running on.
 */
function useScrollEdges(
  element: HTMLElement | null,
  covered?: MotionValue<number>,
): { overflows: boolean; top: boolean; bottom: boolean } {
  const [edges, setEdges] = useState({ overflows: false, top: false, bottom: false })
  useLayoutEffect(() => {
    if (!element) return
    const measure = () => {
      const { scrollTop, scrollHeight, clientHeight } = element
      // Where the content ends, not the scroller: a part-height sheet's scroller runs on past
      // the window's foot with nothing in it.
      const end = element.firstElementChild?.getBoundingClientRect().bottom ?? 0
      const visibleEnd = element.getBoundingClientRect().bottom - (covered?.get() ?? 0)
      const next = {
        overflows: scrollHeight > clientHeight,
        top: scrollTop > 0,
        bottom: end > visibleEnd + 1,
      }
      setEdges((current) =>
        current.overflows === next.overflows &&
        current.top === next.top &&
        current.bottom === next.bottom
          ? current
          : next,
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    // The content's one wrapper grows with whatever it holds.
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    element.addEventListener('scroll', measure, { passive: true })
    const stop = covered?.on('change', measure)
    return () => {
      observer.disconnect()
      element.removeEventListener('scroll', measure)
      stop?.()
    }
  }, [element, covered])
  return edges
}

function PointerDialog(props: SheetProps) {
  const {
    onOpenChange,
    title,
    labelledBy,
    locked = false,
    asksOnBack = false,
    describedBy,
    primary,
    cancel,
    closeButton = false,
    primaryLarge = false,
    stackedActions = false,
    inlineActions = false,
    tertiary,
    accessory,
    footnote,
    origin,
    children,
  } = props
  const [content, setContent] = useState<HTMLDivElement | null>(null)
  const edges = useScrollEdges(content)
  const close = () => onOpenChange(false)
  const footer = hasFooter(props)
  const pinned = footer && !inlineActions
  const actions = hasActions(props)
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
      <Dialog
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className="flex max-h-full min-h-0 flex-col"
      >
        <SheetHeader
          title={title}
          edge={edges.top}
          onClose={actions && !closeButton ? undefined : close}
        />
        <div ref={setContent} className="min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-4">
          <div>
            {children}
            {footer && inlineActions && (
              <InlineActions
                primary={primary}
                primaryLarge={primaryLarge}
                stacked={stackedActions}
                cancel={cancel}
                tertiary={tertiary}
                accessory={accessory}
                footnote={footnote}
                onClose={close}
                touch={false}
              />
            )}
          </div>
        </div>
        {pinned && (
          <SheetFooter
            primary={primary}
            primaryLarge={primaryLarge}
            stacked={stackedActions}
            cancel={cancel}
            tertiary={tertiary}
            accessory={accessory}
            footnote={footnote}
            onClose={close}
            touch={false}
            edge={edges.bottom}
            className="pb-4"
          />
        )}
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

/**
 * The height the sheet's column needs to show all of its content: the column less the room its
 * scroller has, plus the room the scroller's content takes. Null until measured.
 */
function useFittedHeight(column: HTMLElement | null): number | null {
  const [fitted, setFitted] = useState<number | null>(null)
  useLayoutEffect(() => {
    const scroller = column?.querySelector<HTMLElement>('[data-sheet-content]')
    const content = scroller?.firstElementChild
    if (!column || !scroller || !content) return
    const measure = () => {
      const style = getComputedStyle(scroller)
      const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom)
      setFitted(
        Math.ceil(
          column.offsetHeight -
            scroller.clientHeight +
            content.getBoundingClientRect().height +
            padding,
        ),
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    // The chrome around the content changes too: a rotation rewraps the title, and the keyboard
    // pads the column's foot.
    observer.observe(column)
    return () => observer.disconnect()
  }, [column])
  return fitted
}

function subscribeKeyboard(onChange: () => void): () => void {
  const viewport = window.visualViewport
  viewport?.addEventListener('resize', onChange)
  viewport?.addEventListener('scroll', onChange)
  return () => {
    viewport?.removeEventListener('resize', onChange)
    viewport?.removeEventListener('scroll', onChange)
  }
}

/**
 * How far the on-screen keyboard reaches up the window, in px. A browser that overlays the
 * keyboard shrinks only the visual viewport, so the sheet's foot would sit under it. A pinch zoom
 * shrinks it too, and is not a keyboard.
 */
function useKeyboardInset(): number {
  return useSyncExternalStore(subscribeKeyboard, () => {
    const viewport = window.visualViewport
    if (!viewport || viewport.scale > 1.01) return 0
    return Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))
  })
}

function TouchSheet(props: SheetProps) {
  const {
    onOpenChange,
    title,
    labelledBy,
    height = 'part',
    locked = false,
    asksOnBack = false,
    describedBy,
    primary,
    cancel,
    closeButton = false,
    primaryLarge = false,
    stackedActions = false,
    inlineActions = false,
    tertiary,
    accessory,
    footnote,
    origin,
    children,
  } = props
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
  const partY = closedY - viewport.height * SHEET.partRatio
  const [column, setColumn] = useState<HTMLDivElement | null>(null)
  const fitted = useFittedHeight(height === 'fit' ? column : null)
  // Content taller than part height rests there and drags to full, as a part-height sheet does.
  const fittedY = fitted === null ? partY : closedY - fitted
  const fitsPart = fittedY >= partY
  const openY = height === 'part' ? partY : height === 'fit' ? Math.max(partY, fittedY) : 0
  const detents = height === 'part' || (height === 'fit' && !fitsPart) ? [0, openY] : [openY]
  const canRiseFull = detents.includes(0)
  const y = useMotionValue(reduceMotion ? openY : closedY)

  const dragControls = useDragControls()
  // The sheet slides down to part height rather than shrinking, so its foot sits off screen
  // there. The footer rises by that much to stay at the window's foot, and no more, so a drag to
  // close carries it off with the sheet.
  const openAt = useMotionValue(openY)
  useLayoutEffect(() => openAt.set(openY), [openAt, openY])
  const covered = useTransform([y, openAt], ([value, at]: number[]) => clamp(value!, 0, at!))
  // The page dims as the sheet rises. A fitted sheet rests low, so it dims fully at its rest, as
  // an alert does.
  const fit = height === 'fit'
  const backdrop = useTransform([y, openAt], ([value, at]: number[]) =>
    scrim(
      fit
        ? clamp((closedY - value!) / Math.max(1, closedY - at!), 0, 1)
        : 1 - clamp(value! / closedY, 0, 1),
    ),
  )
  const footerY = useTransform(covered, (value) => -value)
  const [content, setContent] = useState<HTMLDivElement | null>(null)
  const edges = useScrollEdges(content, covered)
  const contentScrolls = edges.overflows
  const keyboard = useKeyboardInset()
  const footer = hasFooter(props)
  const pinned = footer && !inlineActions
  const actions = hasActions(props)
  const close = () => onOpenChange(false)
  useRecede(y, closedY)

  // Where the sheet rests, so a new window size, such as a rotation, keeps it there.
  const detent = useRef<'part' | 'full'>(height === 'full' ? 'full' : 'part')
  const settle = (target: number, velocity = 0) => {
    detent.current = target === 0 ? 'full' : 'part'
    if (reduceMotion) y.jump(target)
    else animate(y, target, { ...SPRING, velocity })
  }

  useEffect(() => {
    // The keyboard covers most of a part-height sheet, so typing raises it to full.
    if (keyboard > 0 && canRiseFull) detent.current = 'full'
    const target = detent.current === 'full' && canRiseFull ? 0 : openY
    if (reduceMotion) y.jump(target)
    else animate(y, target, { duration: DURATION.long, ease: EASE })
  }, [y, openY, reduceMotion, keyboard, canRiseFull])

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
        dragConstraints={{
          top: Math.min(...detents),
          bottom: locked ? Math.max(...detents) : closedY,
        }}
        dragElastic={{ top: 0.05, bottom: locked ? SHEET.lockedElastic : 0 }}
        onDragEnd={onDragEnd}
      >
        <Dialog aria-labelledby={labelledBy} aria-describedby={describedBy} className="h-full">
          <div
            ref={setColumn}
            className="flex h-full flex-col pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]"
            style={{ paddingBottom: keyboard }}
            onPointerDown={startDrag}
          >
            <div className="flex touch-none justify-center pt-2" aria-hidden>
              <div className="bg-silver h-1.5 w-10 rounded-(--radius-capsule)" />
            </div>
            <div className="touch-none">
              <SheetHeader
                title={title}
                edge={edges.top}
                onClose={actions && !closeButton ? undefined : close}
              />
            </div>
            <div
              ref={setContent}
              data-sheet-content
              className={`min-h-0 flex-1 overflow-y-auto px-4 pt-1 ${
                pinned ? 'pb-4' : 'pb-[max(1rem,env(safe-area-inset-bottom))]'
              } ${contentScrolls ? 'touch-pan-y' : 'touch-none'}`}
            >
              <div>
                {children}
                {footer && inlineActions && (
                  <InlineActions
                    primary={primary}
                    primaryLarge={primaryLarge}
                    stacked={stackedActions}
                    cancel={cancel}
                    tertiary={tertiary}
                    accessory={accessory}
                    footnote={footnote}
                    onClose={close}
                    touch
                  />
                )}
              </div>
            </div>
            {pinned && (
              <SheetFooter
                primary={primary}
                primaryLarge={primaryLarge}
                stacked={stackedActions}
                cancel={cancel}
                tertiary={tertiary}
                accessory={accessory}
                footnote={footnote}
                onClose={close}
                touch
                edge={edges.bottom}
                // The keyboard covers the home indicator, so its safe area only applies without it.
                className={`touch-none ${keyboard > 0 ? 'pb-3' : 'pb-[max(0.75rem,env(safe-area-inset-bottom))]'}`}
                style={{ y: footerY }}
              />
            )}
          </div>
        </Dialog>
      </MotionModal>
    </MotionModalOverlay>
  )
}
