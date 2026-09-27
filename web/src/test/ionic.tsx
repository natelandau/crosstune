import { IonApp, IonPage, IonRouterOutlet } from '@ionic/react'
import { IonReactMemoryRouter } from '@ionic/react-router'
import { render } from '@testing-library/react'
import { StrictMode, type ReactElement, type ReactNode } from 'react'
import { Route } from 'react-router-dom'
import { AuthProvider, type AuthSession } from '../auth/AuthContext'
import { DbContext } from '../db/DbProvider'
import type { CrosstuneDb } from '../db/schema'
import { Dock } from '../features/player/Dock'
import type { PlaybackEngine } from '../features/player/playbackEngine'
import {
  PlaybackEngineContext,
  PlaybackEngineProvider,
} from '../features/player/PlaybackEngineProvider'
import { PlayerProvider } from '../features/player/PlayerProvider'
import { PlayerContext, type Player } from '../features/player/usePlayer'
import { RecordingScreenProvider } from '../features/recording-screen/RecordingScreenProvider'
import { SelectionProvider } from '../features/selection/SelectionProvider'
import { SyncContext } from '../sync/SyncProvider'
import type { SyncEngine } from '../sync/types'
import { ToastProvider } from '../ui/Toast'
import { fakeEngine, testSession } from './providers'

export interface Options {
  db: CrosstuneDb
  engine?: SyncEngine
  session?: AuthSession
  /** A stand-in player, to watch what a tree asks of it. Omitted, the real provider runs. */
  player?: Player
  /** A stand-in playback engine, for a test that drives or inspects it. Omitted, the real
   * provider runs, backed by a real (unplayed) `<audio>` element. */
  playbackEngine?: PlaybackEngine
  /** Mount the recording screen, so a row's Edit action and the dock's title open it. */
  recordingScreen?: boolean
  /** Mount the dock beside the tree, so a recording the player loads reaches the engine. */
  dock?: boolean
}

// Test helpers, not app code, so mixing this component with the render functions below
// costs nothing: fast refresh never runs against a test file.
// eslint-disable-next-line react-refresh/only-export-components
function Providers({
  db,
  engine = fakeEngine(),
  session = testSession,
  player,
  playbackEngine,
  recordingScreen = false,
  dock = false,
  children,
}: Options & { children: ReactNode }) {
  const docked = dock ? (
    <>
      {children}
      <Dock />
    </>
  ) : (
    children
  )
  const withScreen = recordingScreen ? (
    <RecordingScreenProvider>{docked}</RecordingScreenProvider>
  ) : (
    docked
  )
  // PlayerProvider reaches the engine (to prime it inside a Play tap), so it nests inside
  // PlaybackEngineProvider, matching Shell.
  const withPlayer = player ? (
    <PlayerContext.Provider value={player}>{withScreen}</PlayerContext.Provider>
  ) : (
    <PlayerProvider>{withScreen}</PlayerProvider>
  )
  const withEngine = playbackEngine ? (
    <PlaybackEngineContext.Provider value={playbackEngine}>
      {withPlayer}
    </PlaybackEngineContext.Provider>
  ) : (
    <PlaybackEngineProvider>{withPlayer}</PlaybackEngineProvider>
  )
  return (
    <AuthProvider value={session}>
      <DbContext.Provider value={db}>
        <SyncContext.Provider value={engine}>
          <IonApp>
            <ToastProvider>
              <SelectionProvider>{withEngine}</SelectionProvider>
            </ToastProvider>
          </IonApp>
        </SyncContext.Provider>
      </DbContext.Provider>
    </AuthProvider>
  )
}

/** A component that needs the data providers and Ionic, but no router. */
export function renderIonic(ui: ReactElement, options: Options) {
  return render(<Providers {...options}>{ui}</Providers>)
}

/**
 * A screen (an IonPage) inside a memory router at `path`, matched by `route` so it can read
 * params. Each probe renders a heading at its pattern, so a test can see where the screen went.
 */
export function renderScreen(
  ui: ReactElement,
  {
    path = '/',
    route = '*',
    probes = {},
    strict = false,
    ...options
  }: Options & {
    path?: string
    route?: string
    probes?: Record<string, string>
    /** Render inside StrictMode, which double-invokes effects the way the app's dev build does. */
    strict?: boolean
  },
) {
  const screen = (
    <Providers {...options}>
      <IonReactMemoryRouter initialEntries={[path]}>
        <IonRouterOutlet>
          {[
            ...Object.entries(probes).map(([pattern, text]) => (
              <Route
                key={pattern}
                path={pattern}
                element={
                  <IonPage>
                    <h1>{text}</h1>
                  </IonPage>
                }
              />
            )),
            <Route key={route} path={route} element={ui} />,
          ]}
        </IonRouterOutlet>
      </IonReactMemoryRouter>
    </Providers>
  )
  return render(strict ? <StrictMode>{screen}</StrictMode> : screen)
}
