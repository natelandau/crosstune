import { IonTabsContext, useIonRouter, useIonViewDidLeave } from '@ionic/react'
import { useCallback, useContext, useRef } from 'react'
import type { TabSpec } from './tabs'

type Tab = Pick<TabSpec, 'tab' | 'href'>

/**
 * The tab bar's button for a tab. Its href is the page the tab currently shows and its
 * `selected` whether the tab is active, the one place Ionic exposes either.
 */
function tabButton(tab: string): HTMLIonTabButtonElement | null {
  return document.querySelector<HTMLIonTabButtonElement>(`ion-tab-button[tab="${tab}"]`)
}

/**
 * Opens a tab at its root from a page in another tab, the way tapping its button twice would:
 * the first switch returns to the page the tab last showed, the second pops that tab back to
 * its root. Going through the tab bar keeps the leaving tab's stack, so Back to that tab finds
 * this page again. The calling page must stay mounted until it has left.
 */
export function useOpenTabRoot(): (tab: Tab) => void {
  const tabs = useContext(IonTabsContext)
  const router = useIonRouter()
  const popping = useRef<Tab | null>(null)
  // The second tap waits for the switch to land, since the tab bar reads its active tab from
  // the route it renders.
  useIonViewDidLeave(() => {
    const tab = popping.current
    popping.current = null
    // A musician who moved on to another tab in the meantime stays there.
    if (tab && tabButton(tab.tab)?.selected) tabs.selectTab(tab.tab)
  })
  return useCallback(
    (tab) => {
      const button = tabButton(tab.tab)
      if (button?.href && button.href !== tab.href) popping.current = tab
      // Outside the tab shell there is no tab bar to switch through.
      if (!tabs.selectTab(tab.tab)) router.push(tab.href, 'forward', 'push')
    },
    [tabs, router],
  )
}
