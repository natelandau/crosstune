import { useLayoutEffect, useState, type ReactNode, type Ref } from 'react'
import { useFrame } from '../platform/frame'
import { AccountButton } from './AccountButton'
import { ColumnTitle } from './ColumnTitle'
import { usePane, usePinnedBarClearance } from './pane'
import { PaneBar } from './PaneBar'
import { ScreenSyncBadge } from './SyncBadge'
import { InBar } from '../ui/inBar'

interface RootBarProps {
  title: string
  /** Reaches the screen's one heading, where focus lands when a control holding it leaves. */
  titleRef?: Ref<HTMLHeadingElement>
  actions?: ReactNode
  /** The screen's search field, pinned under the row on the phone. */
  search?: ReactNode
  /** Selection's controls, which take the place of the title row and the actions. */
  selection?: ReactNode
}

/**
 * A destination root's top: its title, its actions, and on the phone the account button. Split
 * and wide keep the pane bar over the column title. The phone has one row, the large title
 * leading and the actions and account button trailing, which pins on scroll with the title shrunk
 * into it and the search field under it.
 */
export function RootBar({ title, titleRef, actions, search, selection }: RootBarProps) {
  const phone = useFrame() === 'phone'
  if (phone) {
    return (
      <PhoneRootBar
        title={title}
        titleRef={titleRef}
        actions={actions}
        search={search}
        selection={selection}
      />
    )
  }
  return (
    <>
      {selection ?? <PaneBar title={title} trailing={actions} />}
      <ColumnTitle title={title} titleRef={titleRef} />
      {search && <div className="px-4 pb-2">{search}</div>}
    </>
  )
}

function PhoneRootBar({ title, titleRef, actions, search, selection }: RootBarProps) {
  const pane = usePane()
  const bar = pane?.bar
  const setTitleOut = pane?.setTitleOut
  const [collapsed, setCollapsed] = useState(false)
  usePinnedBarClearance(bar)

  // The row is the only place the title shows, so no other bar repeats it.
  useLayoutEffect(() => {
    if (!setTitleOut) return
    setTitleOut(false)
    return () => setTitleOut(null)
  }, [setTitleOut])

  // Read before paint as well as on scroll, so a pane that opens scrolled starts collapsed. The
  // bar pins once the content has scrolled by its top padding, which its negative top hides.
  // The scroller is found from the bar, since its own ref is not yet set when the two mount
  // together.
  useLayoutEffect(() => {
    const element = bar?.current
    const root = element?.closest<HTMLElement>('[data-pane-scroller]')
    if (!root || !element) return
    const update = () => {
      const lift = parseFloat(getComputedStyle(element).paddingTop)
      setCollapsed(root.scrollTop > lift)
    }
    update()
    root.addEventListener('scroll', update, { passive: true })
    return () => root.removeEventListener('scroll', update)
  }, [bar])

  return (
    <div
      ref={bar}
      data-root-bar
      data-collapsed={collapsed}
      className="bg-ground sticky -top-2 z-10 pt-2"
    >
      {selection ?? (
        <div data-root-row className="flex h-11 items-center gap-1 ps-4 pe-2">
          <div className="flex min-w-0 flex-1 items-center">
            {/* Scaled rather than resized, so the row never reflows as the title shrinks, and
                with the badge, so the badge stays beside the small title. */}
            <div
              className={`flex min-w-0 origin-left items-center gap-2 transition-[scale] duration-(--dur-short) ease-(--ease) rtl:origin-right ${collapsed ? 'scale-(--screen-title-collapsed)' : ''}`}
            >
              <h1 ref={titleRef} className="t-screen-title min-w-0 truncate">
                {title}
              </h1>
              <ScreenSyncBadge />
            </div>
          </div>
          <InBar value>
            {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
            <AccountButton />
          </InBar>
        </div>
      )}
      {search && (
        <div data-root-search className="px-4 pb-2">
          {search}
        </div>
      )}
    </div>
  )
}
