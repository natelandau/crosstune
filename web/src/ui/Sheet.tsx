import { ChevronLeft, X, type LucideIcon } from 'lucide-react'
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
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { BACK, CANCEL, CLOSE } from './confirmCopy'
import { useLatest } from './useLatest'
import { useStampedDensity } from '../platform/density'
import { DURATION, EASE, SPRING } from '../theme/motion'
import { Button } from './Button'
import { InBar } from './inBar'
import { HeadingLevelContext } from './headingLevel'
import { TONE_VARIANT, type ActionTone } from './toneVariant'
import { PointerOverlay } from './PointerOverlay'
import { scaleBackground } from './backgroundScale'
import {
  growScale,
  originBox,
  releaseTarget,
  SCRIM_COLOR,
  scrimOpacity,
  SHEET,
} from './sheetGeometry'
import { useOverlayClaim } from './overlayClaim'
import { useFittedHeight, useKeyboardInset, useScrollEdges, useViewport } from './sheetMeasure'
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
  /**
   * Shows a Back control leading the header, for a sheet whose body has swapped to a page of its
   * own, in place of the header's close button.
   */
  onBack?: () => void
  /** Above the actions, such as a choice the primary acts on. */
  accessory?: ReactNode
  /** Below the actions, such as the terms of a sale. */
  footnote?: ReactNode
  /** Runs once the sheet has finished closing and left the page. */
  onClosed?: () => void
  /** The control the sheet grows out of and closes back into, such as the Record button. */
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
    // A sheet opened from a bar is content, not part of the bar.
    <InBar value={false}>
      <HeadingLevelContext value={2}>
        <AnimatePresence onExitComplete={props.onClosed}>
          {props.isOpen &&
            (density === 'touch' ? (
              <TouchSheet key="touch" {...props} />
            ) : (
              <PointerDialog key="pointer" {...props} />
            ))}
        </AnimatePresence>
      </HeadingLevelContext>
    </InBar>
  )
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
  onBack,
}: {
  title?: string
  /** Content has scrolled up under the header, so a hairline sets it apart. */
  edge: boolean
  /** Shown as a close button, for a sheet with no footer. */
  onClose?: () => void
  /** Shown as a Back control leading the title, which takes the close button's place. */
  onBack?: () => void
}) {
  return (
    // The body takes 4px of the gap below, so the ring of a field at its top is not clipped.
    <header
      className={`flex min-h-(--target-control) items-center gap-3 border-b px-4 pt-3 pb-2 transition-colors duration-(--dur-short) ${
        edge ? 'border-default' : 'border-transparent'
      }`}
    >
      {onBack && (
        <span className="-ms-2 flex">
          <Button iconOnly icon={ChevronLeft} label={BACK} onPress={onBack} />
        </span>
      )}
      {title === undefined ? (
        <div className="min-w-0 flex-1" />
      ) : (
        <Heading slot="title" level={2} className="t-heading min-w-0 flex-1 break-words">
          {title}
        </Heading>
      )}
      {onClose && !onBack && <Button iconOnly icon={X} label={CLOSE} onPress={onClose} />}
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
      className={`bg-page flex flex-col gap-3 border-t px-4 pt-3 transition-colors duration-(--dur-short) ${
        edge ? 'border-default' : 'border-transparent'
      } ${className}`}
      style={style}
    >
      <SheetActions {...actions} />
    </motion.footer>
  )
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
    onBack,
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
      className="bg-page flex max-h-full max-w-full flex-col overflow-hidden rounded-(--radius-surface) shadow-(--shadow-float)"
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
          onBack={onBack}
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

/** Drives the page's background scale from `y`, 0 (full) to `closedY` (none), while this sheet shows. */
function useBackgroundScale(y: MotionValue<number>, closedY: number): void {
  useLayoutEffect(() => {
    const backgroundScale = scaleBackground()
    const update = (value: number) => backgroundScale.set(1 - clamp(value / closedY, 0, 1))
    update(y.get())
    const stop = y.on('change', update)
    return () => {
      stop()
      backgroundScale.release()
    }
  }, [y, closedY])
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
    onBack,
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
    scrimOpacity(
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
  useBackgroundScale(y, closedY)

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
  // A layout effect, so the commit that starts the exit also cancels the pending return; a
  // passive cleanup can run a frame into the exit, and a return firing then springs it back up.
  useLayoutEffect(() => {
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
      // Reduced motion trades the slide for a cross-fade of the whole overlay.
      initial={reduceMotion ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      exit={reduceMotion ? { opacity: 0, transition: fade } : undefined}
      transition={fade}
    >
      {/* A layer that fades, since animating a color repaints the whole window each frame. */}
      <motion.div
        aria-hidden
        data-sheet-dim
        className="absolute inset-0"
        style={{ opacity: backdrop, backgroundColor: SCRIM_COLOR }}
      />
      <MotionModal
        className="bg-page absolute inset-x-0 rounded-t-(--radius-surface) shadow-(--shadow-float) after:absolute after:inset-x-0 after:top-full after:h-16 after:bg-inherit"
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
              <div className="bg-handle h-1.5 w-10 rounded-(--radius-capsule)" />
            </div>
            <div className="touch-none">
              <SheetHeader
                title={title}
                edge={edges.top}
                onClose={actions && !closeButton ? undefined : close}
                onBack={onBack}
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
