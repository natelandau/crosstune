import {
  IonRouterOutlet,
  IonSplitPane,
  IonTabs,
  IonTabsContext,
  type IonTabsContextState,
} from '@ionic/react'
import { IonReactMemoryRouter, IonReactRouter } from '@ionic/react-router'
import { useCallback, useContext, useEffect, useRef, type RefObject } from 'react'
import { Dock } from '../features/player/Dock'
import { PlayerProvider } from '../features/player/PlayerProvider'
import { RecordProvider, useRecord } from '../features/recording/useRecord'
import { SelectionProvider, useSelectionChrome } from '../features/selection/SelectionProvider'
import { useFrame } from '../platform/frame'
import { ToastProvider } from '../ui/Toast'
import { PhoneTabBar } from './PhoneTabBar'
import { routes } from './routes'
import { Sidebar } from './Sidebar'

const PANE_ID = 'app-main-pane'

/**
 * Everything inside the auth gate. One outlet holds the four tab stacks; the frame decides
 * whether a tab bar or a sidebar surrounds it. `initialPath` puts tests at a route without a
 * browser history.
 */
export function Shell({ initialPath }: { initialPath?: string }) {
  const Router = initialPath ? IonReactMemoryRouter : IonReactRouter
  const routerProps = initialPath ? { initialEntries: [initialPath] } : {}
  return (
    <PlayerProvider>
      <Router {...routerProps}>
        <ToastProvider>
          {/* Inside the router, so starting a recording can also navigate. */}
          <RecordProvider>
            <SelectionProvider>
              <Frames />
            </SelectionProvider>
          </RecordProvider>
        </ToastProvider>
      </Router>
    </PlayerProvider>
  )
}

function Frames() {
  const frame = useFrame()
  const { start } = useRecord()
  const { selecting } = useSelectionChrome()
  const tabsRef = useRef<IonTabsContextState | null>(null)
  // The tab bar remembers where each stack was, so the sidebar switches tabs through it and a
  // stack keeps its pushed pages on both frames.
  const selectTab = useCallback((tab: string) => tabsRef.current?.selectTab(tab), [])
  return (
    <IonSplitPane when="md" contentId={PANE_ID}>
      <Sidebar contentId={PANE_ID} onSelectTab={selectTab} onRecord={() => start()} />
      <div className="ion-page" id={PANE_ID}>
        <IonTabs>
          <IonRouterOutlet animated={frame === 'phone'}>{routes}</IonRouterOutlet>
          <TabsHandle intoRef={tabsRef} />
          {/* Before the tab bar in the same slot, so the player stacks above it on either frame. */}
          <Dock />
          <PhoneTabBar hidden={frame === 'wide' || selecting} onRecord={() => start()} />
        </IonTabs>
      </div>
    </IonSplitPane>
  )
}

/** Hands IonTabs' context out to the sidebar, which sits beside IonTabs rather than in it. */
function TabsHandle({ intoRef }: { intoRef: RefObject<IonTabsContextState | null> }) {
  const context = useContext(IonTabsContext)
  useEffect(() => {
    intoRef.current = context
  }, [context, intoRef])
  return null
}
