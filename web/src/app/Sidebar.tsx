import { IonContent, IonItem, IonLabel, IonList, IonMenu } from '@ionic/react'
import { Mic } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { Lockup } from '../ui/Mark'
import { SyncBadge } from '../ui/SyncBadge'
import { TABS } from './tabs'

/**
 * The wide frame's navigation: the lockup, the four destinations, the record control, and the
 * sync state. Recording is not a destination, so it sits below the list as its own control.
 */
export function Sidebar({
  contentId,
  onSelectTab,
  onRecord,
}: {
  contentId: string
  onSelectTab: (tab: string) => void
  onRecord: () => void
}) {
  const { pathname } = useLocation()
  return (
    // No swipe: on a phone the tab bar is the navigation, and an edge swipe would pull this open.
    <IonMenu
      contentId={contentId}
      type="push"
      swipeGesture={false}
      role="navigation"
      aria-label="Sidebar"
    >
      <IonContent>
        <div className="px-5 pt-6 pb-4">
          <Lockup className="type-title" />
        </div>
        <IonList lines="none">
          {TABS.map((tab) => {
            const current = pathname === tab.href || pathname.startsWith(`${tab.href}/`)
            return (
              <IonItem
                key={tab.tab}
                button
                onClick={() => onSelectTab(tab.tab)}
                detail={false}
                color={current ? 'light' : undefined}
                aria-current={current ? 'page' : undefined}
              >
                <tab.icon aria-hidden="true" slot="start" className="size-5" />
                <IonLabel>{tab.label}</IonLabel>
              </IonItem>
            )
          })}
        </IonList>
        <IonList lines="none">
          <IonItem button detail={false} aria-label="Start a new recording" onClick={onRecord}>
            <Mic aria-hidden="true" slot="start" className="size-5" />
            <IonLabel>Record</IonLabel>
          </IonItem>
        </IonList>
        <div className="px-5 py-4">
          <SyncBadge />
        </div>
      </IonContent>
    </IonMenu>
  )
}
