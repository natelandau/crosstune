import {
  IonBackButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
} from '@ionic/react'
import type { ReactNode } from 'react'
import { useFrame } from '../platform/frame'
import { getMode } from '../platform/mode'
import { SyncBadge } from './SyncBadge'

export interface ScreenProps {
  title: ReactNode
  /** A class for the title, such as `tabular-nums` where the title carries a count. */
  titleClass?: string
  /** A top-level screen opens with a large title on iOS. A pushed screen has a back button. */
  level: 'top' | 'pushed'
  /** Where Back goes when the stack has no history, for a pushed screen opened from a link. */
  backHref?: string
  /**
   * True while the screen wears a selection toolbar. The contextual bar stands in for the
   * screen's own chrome, so its exit control takes the back button's place: two ways out of
   * one bar, one of which drops the selection on its way off the screen, is one too many, and
   * the count beside them needs the room.
   */
  selecting?: boolean
  /** Controls at the toolbar's leading edge, after any back button. */
  start?: ReactNode
  /** Controls at the toolbar's trailing edge. At most four, which md's selection toolbar takes. */
  end?: ReactNode
  /** A search bar under the title on a top-level screen. */
  search?: ReactNode
  /** Controls at the trailing edge of the search row, such as the catalog's Filters. */
  searchEnd?: ReactNode
  /** An `IonRefresher`, which works only as a direct child of the content. */
  refresher?: ReactNode
  /** Something fixed under the content, such as a tab bar or a selection toolbar. */
  footer?: ReactNode
  /** A screen made of inset groups takes the grouped background, so each group reads as a card. */
  grouped?: boolean
  children: ReactNode
}

/**
 * Every screen is this: a toolbar, a scrolling content area, and on the wide frame a centered
 * column. On iOS a top-level screen also gets the large title that shrinks into the toolbar
 * as the content scrolls; Ionic hides that inner header on md, so the search bar sits in the
 * fixed toolbar there.
 *
 * A screen carries the sync badge, so it renders inside a SyncProvider.
 */
export function Screen({
  title,
  titleClass,
  level,
  backHref,
  selecting = false,
  start,
  end,
  search,
  searchEnd,
  refresher,
  footer,
  grouped = false,
  children,
}: ScreenProps) {
  const condense = level === 'top' && getMode() === 'ios'
  const barTitleClass =
    [selecting ? 'selection-title' : null, titleClass].filter(Boolean).join(' ') || undefined
  const frame = useFrame()
  return (
    <IonPage>
      <IonHeader translucent>
        <IonToolbar>
          {level === 'top' && frame === 'phone' ? (
            <div slot="start">
              <SyncBadge />
            </div>
          ) : null}
          <IonButtons slot="start">
            {level === 'pushed' && !selecting ? <IonBackButton defaultHref={backHref} /> : null}
            {start}
          </IonButtons>
          <IonTitle className={barTitleClass}>{title}</IonTitle>
          <IonButtons slot="end">{end}</IonButtons>
        </IonToolbar>
        {search && !condense ? <SearchBar search={search} end={searchEnd} /> : null}
      </IonHeader>
      <IonContent fullscreen className={grouped ? 'grouped' : undefined}>
        {refresher}
        {condense ? (
          <IonHeader collapse="condense">
            <IonToolbar className="screen-column">
              <IonTitle size="large" className={titleClass}>
                {title}
              </IonTitle>
            </IonToolbar>
            {search ? <SearchBar search={search} end={searchEnd} /> : null}
          </IonHeader>
        ) : null}
        {/* The screen's landmark, and the focus target of last resort for a control that
            leaves while it holds focus. */}
        <main
          tabIndex={-1}
          className={`mx-auto w-full max-w-(--measure) pb-(--tab-bar-cap) outline-none ${
            grouped ? 'pb-8' : ''
          }`}
        >
          {children}
        </main>
      </IonContent>
      {footer}
    </IonPage>
  )
}

/**
 * The search row. Ionic gives unslotted toolbar content the flexible middle, so the field gives
 * up the room a trailing control takes instead of sitting under it.
 */
function SearchBar({ search, end }: { search: ReactNode; end?: ReactNode }) {
  return (
    <IonToolbar className="screen-column">
      {search}
      {end ? <IonButtons slot="end">{end}</IonButtons> : null}
    </IonToolbar>
  )
}
