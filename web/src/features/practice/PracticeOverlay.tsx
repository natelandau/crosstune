import {
  AnimatePresence,
  animate,
  motion,
  useDragControls,
  useMotionValue,
  useReducedMotionConfig,
  type PanInfo,
} from 'motion/react'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Dialog, Modal, ModalOverlay } from 'react-aria-components'
import { useNavigate } from 'react-router'
import { useAnalytics } from '../../analytics/AnalyticsProvider'
import { listPosition } from '../player/playerCopy'
import { useListPlayback } from '../player/useListPlayback'
import { useRecordingActionsWith } from '../recordings/useRecordingActionsWith'
import { practiceBlocker, trimBlocker } from './practiceOverlayModel'
import { usePracticeOverlay, usePracticeOverlayShown } from './usePracticeOverlay'
import { usePracticeOverlayView } from './usePracticeOverlayView'
import { useTrimHold } from './useTrimHold'
import { useWakeLock } from '../../platform/wakeLock'
import { useEscapeCapture } from '../../ui/useEscapeCapture'
import { useLatest } from '../../ui/useLatest'
import { destination } from '../../app/destinations'
import { useFrame } from '../../platform/frame'
import { PracticeOpenerContext } from '../player/practiceOpener'
import { AddToTuneSheet } from '../recordings/AddToTuneSheet'
import { EditRecordingSheet } from '../recordings/EditRecordingSheet'
import { DURATION, EASE, SPRING, springEasing } from '../../theme/motion'
import { useConfirm } from '../../ui/Confirm'
import { ErrorLine } from '../../ui/ErrorLine'
import { useOnTop, useOverlayClaim } from '../../ui/overlayClaim'
import { PracticeHeader } from './PracticeHeader'
import { PracticeView, type FocusCarry } from './PracticeView'
import { TrimPanel } from './TrimPanel'

const MotionModal = motion.create(Modal)

/** How far, as a share of the window, a swipe down must carry practice to close it. */
const CLOSE_SHARE = 0.25
/** A swipe down this fast, in px per second, closes practice however short it was. */
const CLOSE_VELOCITY = 800

const SPRING_EASING = springEasing()

const CATALOG = destination('catalog')

/**
 * Practice for the recording the player has loaded, opened from the now-playing bar or the
 * dock's Expand through `PracticeOpenerContext`, which it provides to `children`. It is an
 * overlay, never a route, so the address never changes while it shows. Mount it inside the
 * router, which Go to tune and the sheets from More use.
 */
export function PracticeOverlay({ children }: { children: ReactNode }) {
  const overlay = usePracticeOverlay()
  const { shown, dismissed } = usePracticeOverlayShown()
  return (
    <PracticeOpenerContext.Provider value={overlay.open}>
      {children}
      <AnimatePresence onExitComplete={dismissed}>
        {shown?.open && <PracticeModal key={shown.opening} id={shown.id} onClose={overlay.close} />}
      </AnimatePresence>
    </PracticeOpenerContext.Provider>
  )
}

/**
 * The now-playing bar's box as a clip on practice, which grows out of it. `offsetY` is how far
 * a swipe has carried practice down, so the clip still lands on the bar from there.
 */
function barClip(offsetY: number): string {
  const slot = document.querySelector('[data-now-playing]')
  const width = window.innerWidth
  const height = window.innerHeight
  const rect = slot?.getBoundingClientRect()
  if (!rect || rect.height === 0) return `inset(${height - offsetY}px 0px 0px 0px)`
  const top = rect.top - offsetY
  const bottom = height - rect.bottom + offsetY
  return `inset(${top}px ${width - rect.right}px ${bottom}px ${rect.left}px)`
}

const FULL_CLIP = 'inset(0px 0px 0px 0px)'

function PracticeModal({ id, onClose }: { id: string; onClose: () => void }) {
  const navigate = useNavigate()
  const analytics = useAnalytics()
  // The modal mounts once per open.
  useEffect(() => analytics.screen('recording'), [analytics])
  // A device back steps out as Escape does, through whichever view is showing.
  const stepOutRef = useRef<(() => void) | null>(null)
  const isTop = useOverlayClaim({ coversShell: true, close: () => stepOutRef.current?.() })
  const phone = useFrame() === 'phone'
  const reduceMotion = useReducedMotionConfig() ?? false
  const state = usePracticeOverlayView(id)
  const { view, title, subtitle, shows } = state
  // A take practiced on a music stand, propped up with the hands on the violin, must not dim.
  useWakeLock(true)
  const playback = useListPlayback()
  const listed = playback.active?.message === null ? playback.active : null
  useTrimHold(
    id,
    view !== null && shows === 'trim',
    view ? { speed: view.recording.speed_percent, pitch: view.recording.pitch_cents } : undefined,
  )

  const confirm = useConfirm()
  const actions = useRecordingActionsWith({
    confirm,
    onTrim: state.openTrim,
    trimBlocked: view ? trimBlocker(view.recording, view.file, state.audio) : undefined,
    onOpenTune: (opened) => {
      if (!opened.tuneId) return
      onClose()
      void navigate(`${CATALOG.root}/${opened.tuneId}`)
    },
    onEdit: state.setEditing,
    onAddToTune: state.setFiling,
    onDeleted: onClose,
  })

  // Escape steps out: a rename, then the selection, then practice itself. The window hears it
  // ahead of any field inside, so a rename's Escape ends the rename and nothing more.
  const escapeRef = useRef<(() => boolean) | null>(null)
  const carried = useRef<string | null>(null)
  const [focusCarry] = useState<FocusCarry>(() => ({
    peek: () => carried.current,
    keep: (key) => {
      carried.current = key
    },
  }))
  const onCloseRef = useLatest(onClose)
  const main = shows === 'main'
  const stepOut = useCallback(() => {
    if (escapeRef.current?.()) return
    onCloseRef.current()
  }, [onCloseRef])
  useEffect(() => {
    if (main) stepOutRef.current = stepOut
  }, [main, stepOut])
  useEscapeCapture(stepOut, { enabled: main, when: isTop })

  // Leaving trim puts focus back on More, once whatever trim stacked over practice, such as
  // Save's question, has let go of it.
  const top = useOnTop(isTop)
  const moreRef = useRef<HTMLButtonElement>(null)
  const returning = useRef(false)
  useEffect(() => {
    if (!main || !top) return
    const wasReturning = returning.current
    returning.current = false
    if (wasReturning) moreRef.current?.focus()
  }, [main, top])
  const leavingTrim = (leave: () => void) => () => {
    returning.current = true
    leave()
  }

  // On the phone practice swipes down back into the bar.
  const y = useMotionValue(0)
  const dragControls = useDragControls()
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > window.innerHeight * CLOSE_SHARE || info.velocity.y > CLOSE_VELOCITY) {
      onClose()
      return
    }
    if (reduceMotion) y.jump(0)
    else animate(y, 0, { ...SPRING, velocity: info.velocity.y })
  }

  // The hidden clip is resolved as each animation starts, so closing goes back into wherever
  // the bar is then, from wherever a swipe has left practice.
  const timing = { duration: phone ? DURATION.long : DURATION.base, ease: EASE }
  const variants = reduceMotion
    ? { hidden: { opacity: 0 }, shown: { opacity: 1 } }
    : { hidden: () => ({ clipPath: barClip(y.get()) }), shown: { clipPath: FULL_CLIP } }

  const error = actions.error ?? state.error
  return (
    <>
      <ModalOverlay
        isOpen
        isDismissable={false}
        isKeyboardDismissDisabled
        className="fixed inset-0 z-40"
      >
        <MotionModal
          data-practice
          className="bg-jet fixed inset-0 flex flex-col text-(--panel-ink)"
          style={{ y, colorScheme: 'dark' }}
          drag={phone ? 'y' : false}
          dragListener={false}
          dragControls={dragControls}
          dragMomentum={false}
          dragConstraints={{ top: 0, bottom: window.innerHeight }}
          dragElastic={{ top: 0, bottom: 0 }}
          onDragEnd={onDragEnd}
          variants={variants}
          initial="hidden"
          animate="shown"
          exit="hidden"
          transition={timing}
        >
          <Dialog
            style={{ '--spring': SPRING_EASING } as CSSProperties}
            className="flex h-full min-h-0 flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)] outline-none"
          >
            {shows === 'trim' && view ? (
              <TrimPanel
                // Never one recording's edit over another's.
                key={view.recording.id}
                view={view}
                shown={state.peaks}
                isTop={isTop}
                stepOutRef={stepOutRef}
                onDone={leavingTrim(state.leaveTrim)}
                onTrimmedElsewhere={leavingTrim(state.trimmedElsewhere)}
              />
            ) : (
              <>
                {/* The header shows from the first frame, since the dialog takes its name from
                    the title only if that is there when it mounts. Trim's header keeps the
                    same title slot, so the name follows it. */}
                <PracticeHeader
                  title={title}
                  subtitle={
                    listed ? listPosition(listed.listName, listed.position, listed.count) : subtitle
                  }
                  // The phone's transport row carries the list's controls instead.
                  queue={
                    listed && !phone
                      ? { onPrevious: playback.previous, onNext: playback.next }
                      : null
                  }
                  menu={view ? actions.menuFor(view) : null}
                  moreRef={moreRef}
                  onClose={onClose}
                  onDragStart={phone ? (event) => dragControls.start(event) : undefined}
                />
                {view && (
                  <div className="flex min-h-0 flex-1 flex-col gap-3 px-4">
                    <ErrorLine error={error} place="stack" />
                    {state.trimNotice && (
                      <p role="status" className="t-secondary m-0 text-center">
                        {state.trimNotice}
                      </p>
                    )}
                    {main && (
                      <PracticeView
                        // A list moving on swaps the recording under practice, which starts
                        // its timeline and loops afresh.
                        key={view.recording.id}
                        view={view}
                        shown={state.peaks}
                        blocked={practiceBlocker(view.file, state.audio)}
                        escapeRef={escapeRef}
                        focusCarry={focusCarry}
                        isTop={isTop}
                        onError={state.setError}
                      />
                    )}
                  </div>
                )}
              </>
            )}
          </Dialog>
        </MotionModal>
      </ModalOverlay>
      <EditRecordingSheet view={state.editing} onClose={() => state.setEditing(null)} />
      <AddToTuneSheet
        source="recording_screen"
        view={state.filing}
        onClose={() => state.setFiling(null)}
      />
    </>
  )
}
