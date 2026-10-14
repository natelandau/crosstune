import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

type MovableParent = HTMLElement & { moveBefore?: (node: Node, child: Node | null) => void }

/**
 * Moves `node` to the end of `parent`. An atomic move keeps a playing embed's frame and the
 * focus inside it, where appending would reload the frame, so appending is only the fallback.
 */
function moveInto(parent: MovableParent, node: Node) {
  if (node.isConnected && parent.moveBefore) {
    try {
      parent.moveBefore(node, null)
      return
    } catch {
      // A move between documents or into a disconnected parent is refused.
    }
  }
  parent.appendChild(node)
}

interface Host {
  element: HTMLElement
  priority: number
  order: number
}

interface NowPlaying {
  node: ReactNode
  set: (node: ReactNode) => void
  /** The slot element now holding the docked node, or null. */
  active: HTMLElement | null
  register: (element: HTMLElement, priority: number) => () => void
}

const NowPlayingContext = createContext<NowPlaying | null>(null)

/**
 * Holds what the shell docks as now playing, so the player can fill the slot from anywhere.
 * The node renders once, into one container that the provider places in the highest-priority
 * slot mounted, the newest winning a tie, so a frame change moves the playing item instead of
 * mounting it again.
 */
export function NowPlayingProvider({ children }: { children: ReactNode }) {
  const [node, set] = useState<ReactNode>(null)
  const [container] = useState(() => document.createElement('div'))
  const [active, setActive] = useState<HTMLElement | null>(null)
  const hosts = useRef<Host[]>([])
  const counter = useRef(0)

  const place = useCallback(() => {
    let best: Host | undefined
    for (const host of hosts.current) {
      if (!best || host.priority > best.priority) best = host
      else if (host.priority === best.priority && host.order > best.order) best = host
    }
    if (best && container.parentNode !== best.element) moveInto(best.element, container)
    if (!best) container.remove()
    setActive(best?.element ?? null)
  }, [container])

  const register = useCallback(
    (element: HTMLElement, priority: number) => {
      const host = { element, priority, order: ++counter.current }
      hosts.current = [...hosts.current, host]
      place()
      return () => {
        hosts.current = hosts.current.filter((h) => h !== host)
        place()
      }
    },
    [place],
  )

  const value = useMemo(() => ({ node, set, active, register }), [node, active, register])
  return (
    <NowPlayingContext value={value}>
      {children}
      {node ? createPortal(node, container) : null}
    </NowPlayingContext>
  )
}

/** `set(bar)` docks it, `set(null)` clears it. */
// eslint-disable-next-line react-refresh/only-export-components
export function useNowPlaying(): { set: (node: ReactNode) => void } {
  const context = useContext(NowPlayingContext)
  if (!context) throw new Error('useNowPlaying needs a NowPlayingProvider')
  return { set: context.set }
}

/**
 * A place the docked node can sit: the shell's floating above the tab bar on the phone and at
 * the foot of the content elsewhere, and a layout's own, such as the columns' under the detail
 * pane, which outranks the shell's with a higher `priority`. Only the slot holding the node
 * shows, and none shows while nothing is docked, so no slot reserves space.
 */
export function NowPlayingSlot({
  priority = 0,
  floating = false,
}: {
  priority?: number
  /** A card in the navigation tint over the content, rather than a bar docked under it. */
  floating?: boolean
}) {
  const context = useContext(NowPlayingContext)
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const shown = Boolean(context?.node)
  const register = context?.register

  useLayoutEffect(() => {
    if (!shown || !host || !register) return
    return register(host, priority)
  }, [shown, host, register, priority])

  if (!shown) return null
  return (
    <div
      ref={setHost}
      data-now-playing
      data-nav={floating || undefined}
      data-floating={floating || undefined}
      hidden={context?.active !== host}
      className={
        floating
          ? 'bg-nav border-hairline shrink-0 overflow-hidden rounded-(--radius-surface) border'
          : 'bg-ground border-hairline shrink-0 border-t'
      }
    />
  )
}
