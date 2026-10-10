import { animate, motion, useReducedMotionConfig } from 'motion/react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { providerLabel } from '../links/display'
import { PLAYER_REGION } from './playerCopy'
import { useDockItem, type DockShown } from './useDockItem'
import { useListPlayback } from './useListPlayback'
import { usePlayer } from './usePlayer'
import { usePlayerFocusReturn } from './usePlayerFocusReturn'
import { useRecordingTransport } from './useRecordingTransport'
import { usePracticeOverlay } from '../practice/usePracticeOverlay'
import { useFrame } from '../../platform/frame'
import { useNowPlaying } from '../../app/NowPlayingSlot'
import type { BarProps } from './barParts'
import { DockBar } from './DockBar'
import { EmbedPanel } from './EmbedPanel'
import { PhoneBar } from './PhoneBar'
import { useOpenPractice } from './practiceOpener'
import { DURATION, EASE } from '../../theme/motion'
import { useLatest } from '../../ui/useLatest'

// The gap between the toast and the bar it sits above.
const TOAST_GAP_PX = 8

// The picture of a closed bar still sliding out; one at most, since a new bar replaces it.
let leaving: HTMLElement | null = null

/**
 * Leaves an inert copy of the closing bar where it was and slides the bar down out of its box,
 * so it leaves the way it came. A copy, because the bar's own tree holds the transport, which
 * must stop the moment the player closes. The copy is of the whole slot, ground and all, pinned
 * over the slot's place on the page, since the slot leaves the page with the bar.
 */
function slideOut(section: HTMLElement) {
  const slot = section.closest<HTMLElement>('[data-now-playing]') ?? section
  const { left, top, width, height } = slot.getBoundingClientRect()
  section.dataset.leavingBar = ''
  const ghost = slot.cloneNode(true) as HTMLElement
  delete section.dataset.leavingBar
  const bar = ghost.querySelector<HTMLElement>('[data-leaving-bar]') ?? ghost
  delete bar.dataset.leavingBar
  ghost.inert = true
  ghost.setAttribute('aria-hidden', 'true')
  // Never found as the slot by code that looks for the one on the page.
  ghost.removeAttribute('data-now-playing')
  bar.removeAttribute('aria-label')
  for (const named of ghost.querySelectorAll('[id]')) named.removeAttribute('id')
  // A copied frame or media element would load and play again; a blank box holds its place.
  const media = slot.querySelectorAll('iframe, video, audio')
  ghost.querySelectorAll('iframe, video, audio').forEach((copy, index) => {
    const { width: mediaWidth, height: mediaHeight } = media[index]!.getBoundingClientRect()
    const blank = document.createElement('div')
    blank.style.width = `${mediaWidth}px`
    blank.style.height = `${mediaHeight}px`
    copy.replaceWith(blank)
  })
  const body = bar.firstElementChild
  if (!body) return
  Object.assign(ghost.style, {
    position: 'fixed',
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
    margin: '0',
    pointerEvents: 'none',
  })
  leaving?.remove()
  leaving = ghost
  document.body.append(ghost)
  void animate(body, { y: '100%' }, { duration: DURATION.base, ease: EASE }).finished.then(() => {
    ghost.remove()
    if (leaving === ghost) leaving = null
  })
}

/**
 * Docks the loaded item in the shell's now-playing slot: the phone bar above the tab bar, or
 * the dock across the foot of the detail pane. A list that stopped keeps the bar, with nothing
 * loaded, to say why until it is closed. Mount it once, inside the shell.
 */
export function NowPlaying() {
  const { set } = useNowPlaying()
  const { shown, title } = useDockItem()
  const { active, end } = useListPlayback()
  const message = active?.message ?? null
  const focusRef = usePlayerFocusReturn()

  // The bar reads the transport and the frame itself, so the docked node changes only when
  // what it shows does.
  const bar = useMemo(
    () =>
      message !== null ? (
        <BarFrame focusRef={focusRef}>
          <Bar
            title=""
            detail={null}
            transport={null}
            onOpen={null}
            message={message}
            onClose={end}
          />
        </BarFrame>
      ) : shown ? (
        <BarFrame focusRef={focusRef}>
          <NowPlayingBar shown={shown} title={title} />
        </BarFrame>
      ) : null,
    [message, end, shown, title, focusRef],
  )
  useEffect(() => {
    set(bar)
  }, [set, bar])
  useEffect(() => () => set(null), [set])
  return null
}

function BarFrame({
  focusRef,
  children,
}: {
  focusRef: (element: HTMLElement) => () => void
  children: ReactNode
}) {
  const sectionRef = useRef<HTMLElement>(null)
  const reduceMotionRef = useLatest(useReducedMotionConfig() ?? false)
  // Before the section leaves the page, so its copy can take its place.
  useLayoutEffect(() => {
    leaving?.remove()
    leaving = null
    const section = sectionRef.current
    // The setting as the bar closes, not as it opened.
    const reduceMotion = reduceMotionRef
    return () => {
      if (section?.isConnected && !reduceMotion.current) slideOut(section)
    }
  }, [reduceMotionRef])
  const ref = useCallback(
    (element: HTMLElement) => {
      sectionRef.current = element
      const release = focusRef(element)
      return () => {
        release()
        sectionRef.current = null
      }
    },
    [focusRef],
  )
  useToastClearance(sectionRef)
  return (
    <section
      ref={ref}
      aria-label={PLAYER_REGION}
      // Clipped, so the bar rises out of its own box rather than over the tab bar. The slot
      // paints the ground, which differs between the docked bar and the phone's floating card.
      className="overflow-hidden"
    >
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }}>
        {children}
      </motion.div>
    </section>
  )
}

function NowPlayingBar({ shown, title }: { shown: DockShown; title: string }) {
  const track =
    shown.kind === 'recording' ? `recording:${shown.recording.id}` : `link:${shown.link.id}`
  // Whether the bar has shown another track since it opened, so a new one's title slides in
  // while the first shows with the bar.
  const [seen, setSeen] = useState({ track, changed: false })
  if (seen.track !== track) setSeen({ track, changed: true })
  return shown.kind === 'recording' ? (
    // Keyed, since the transport takes a later blob as the same recording's replaced.
    <RecordingBar key={shown.recording.id} shown={shown} title={title} entering={seen.changed} />
  ) : (
    <>
      <EmbedPanel embed={shown.embed} title={title} />
      <Bar
        title={title}
        detail={providerLabel(shown.link)}
        transport={null}
        onOpen={null}
        entering={seen.changed}
      />
    </>
  )
}

function RecordingBar({
  shown,
  title,
  entering,
}: {
  shown: Extract<DockShown, { kind: 'recording' }>
  title: string
  entering: boolean
}) {
  const { recording, file, tuneTitle } = shown
  // Above the frame's choice of bar, so a resize keeps the recording loaded and playing.
  const practiceOverlay = usePracticeOverlay()
  const transport = useRecordingTransport({
    recording,
    file,
    title,
    held: () => practiceOverlay.held(recording.id),
  })
  const openPractice = useOpenPractice()
  return (
    <Bar
      title={title}
      // A recording with no label already takes its tune's name as its title.
      detail={recording.label !== null ? tuneTitle : null}
      transport={transport}
      onOpen={openPractice ? () => openPractice(recording.id) : null}
      entering={entering}
    />
  )
}

/** Close player closes the player, unless the caller gives its own Close. */
function Bar({ onClose, ...props }: Omit<BarProps, 'onClose'> & { onClose?: () => void }) {
  const { close } = usePlayer()
  const phone = useFrame() === 'phone'
  const closing = onClose ?? close
  return phone ? (
    <PhoneBar {...props} onClose={closing} />
  ) : (
    <DockBar {...props} onClose={closing} />
  )
}

/**
 * Places the toast above the bar while the bar shows, centered on the pane the bar docks in.
 * The bar's slot sits at the foot of its column, so whatever lies below it, such as the tab
 * bar, is cleared too.
 */
function useToastClearance(sectionRef: { current: HTMLElement | null }) {
  useLayoutEffect(() => {
    const section = sectionRef.current
    if (!section) return
    const root = document.documentElement.style
    let observed: Element[] = []
    const measure = () => {
      // The slot is laid out unmoved while the bar rises inside it.
      const slot = section.closest('[data-now-playing]')
      if (!slot) return
      const watch = [slot, slot.previousElementSibling].filter((el): el is Element => !!el)
      if (watch.some((el, i) => el !== observed[i])) {
        observer.disconnect()
        observed = watch
        for (const el of watch) observer.observe(el)
        observer.observe(section)
      }
      const rect = slot.getBoundingClientRect()
      const clearance = window.innerHeight - rect.top + TOAST_GAP_PX
      root.setProperty('--toast-bottom', `${Math.max(clearance, 0)}px`)
      // The slot spans the pane it docks in, so the toast centers on the detail pane on split
      // and wide, and on the window on the phone.
      root.setProperty('--toast-left', `${Math.max(rect.left, 0)}px`)
      root.setProperty('--toast-right', `${Math.max(window.innerWidth - rect.right, 0)}px`)
    }
    // A frame later, so the whole layout has settled before the slot is read.
    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(section)
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      root.removeProperty('--toast-bottom')
      root.removeProperty('--toast-left')
      root.removeProperty('--toast-right')
    }
  }, [sectionRef])
}
