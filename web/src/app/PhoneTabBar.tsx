import { IonLabel, IonTabBar, IonTabButton } from '@ionic/react'
import { TABS } from './tabs'

/**
 * Five equal slots: two tabs, the record button, two tabs. The current tab shows by color
 * alone, which Ionic does per mode. Hidden, not unmounted, on the wide frame, because the
 * tab bar must stay a child of IonTabs for the stacks to work. The landmark is a wrapping
 * nav because Ionic stamps its own tablist role on the bar.
 *
 * The record button is a dome larger than the tabs whose top rises above the bar, over the
 * page, so the page scrolls past on either side of it. It sits outside IonTabBar because the
 * bar clips anything that overflows it.
 */
export function PhoneTabBar({ hidden, onRecord }: { hidden: boolean; onRecord: () => void }) {
  const [catalog, lists, recordings, settings] = TABS
  return (
    <nav slot="bottom" aria-label="Primary" className={`relative ${hidden ? 'hidden' : ''}`}>
      <IonTabBar>
        {[catalog, lists].map((tab) => (
          <IonTabButton key={tab.tab} tab={tab.tab} href={tab.href}>
            <tab.icon aria-hidden="true" className="size-6" />
            <IonLabel className="whitespace-nowrap">{tab.label}</IonLabel>
          </IonTabButton>
        ))}
        {/* IonTabBar renders only tab buttons, so the dome's slot is an empty one that no
            pointer, keyboard, or screen reader reaches. */}
        <IonTabButton tab="record" disabled aria-hidden="true" className="pointer-events-none" />
        {[recordings, settings].map((tab) => (
          <IonTabButton key={tab.tab} tab={tab.tab} href={tab.href}>
            <tab.icon aria-hidden="true" className="size-6" />
            <IonLabel className="whitespace-nowrap">{tab.label}</IonLabel>
          </IonTabButton>
        ))}
      </IonTabBar>
      <button
        type="button"
        className="record-dome"
        aria-label="Start a new recording"
        data-toast-anchor
        onClick={onRecord}
      >
        <span aria-hidden="true" className="record-dome-dot" />
      </button>
    </nav>
  )
}
