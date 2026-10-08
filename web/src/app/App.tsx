import { useMemo, type ReactNode } from 'react'
import { RouterProvider } from 'react-router/dom'
import type { PlaybackEngine } from '../features/player/playbackEngine'
import {
  PlaybackEngineContext,
  PlaybackEngineProvider,
} from '../features/player/PlaybackEngineProvider'
import { ListPlaybackProvider } from '../features/player/ListPlaybackProvider'
import { PlayerProvider } from '../features/player/PlayerProvider'
import { PlayerContext, type Player } from '../features/player/usePlayer'
import { RecordStateProvider, useRecordState } from '../features/recording/RecordState'
import { PracticeOverlayStateProvider } from '../features/practice/PracticeOverlayState'
import { useAppearance } from '../features/settings/appearance'
import { ShortcutSheet } from '../features/keyboard/ShortcutSheet'
import { ShortcutSheetProvider } from '../features/keyboard/ShortcutsProvider'
import type { ShortcutSheetLauncher } from '../features/keyboard/shortcutSheetLauncher'
import { ListNameLauncherProvider } from '../features/lists/ListNameSheet'
import { useDensity } from '../platform/density'
import { QuickFind, QuickFindProvider } from '../features/quickFind/QuickFind'
import { AppMotion } from '../theme/motion'
import { RecordLauncherContext, type RecordLauncher as Launcher } from './recordLauncher'
import { useSchemeSync } from '../theme/scheme'
import { TuneFormLauncherProvider, type TuneFormLauncher } from '../features/tune/formLauncher'
import { TuneFormProvider } from '../features/tune/TuneFormProvider'
import { ConfirmProvider } from '../ui/Confirm'
import { ToastProvider } from '../ui/Toast'
import type { BackAdapter } from '../platform/backHandler'
import { BackStackProvider } from './BackStackProvider'
import { ScreenCommandsProvider } from './screenCommands'
import type { AppRouter } from './router'
import { AppRouterContext } from './appRouterContext'

/** The app's root. The sole caller of `useDensity`, so every leaf reads it stamped. */
export function App({
  router,
  tuneFormLauncher,
  player,
  playbackEngine,
  backAdapter,
  shortcutSheet,
}: {
  router: AppRouter
  /** Stands in for the tune form, for a test that watches what opens it. */
  tuneFormLauncher?: TuneFormLauncher
  /** Stands in for the player, for a test that watches what plays. */
  player?: Player
  /** Stands in for the playback engine, for a test that drives what plays. */
  playbackEngine?: PlaybackEngine
  /** The device's back, such as Android's; the web's by default. */
  backAdapter?: BackAdapter
  /** Stands in for the shortcut sheet, for a test that watches what opens it. */
  shortcutSheet?: ShortcutSheetLauncher
}) {
  useDensity()
  useSchemeSync(useAppearance())
  const sheeted = (
    <ShortcutSheetProvider launcher={shortcutSheet}>
      <QuickFindProvider>
        <ScreenCommandsProvider>
          <ListNameLauncherProvider>
            <AppRouterContext value={router}>
              <RouterProvider router={router} />
            </AppRouterContext>
            <ShortcutSheet />
            <QuickFind navigate={(to, state) => void router.navigate(to, { state })} />
          </ListNameLauncherProvider>
        </ScreenCommandsProvider>
      </QuickFindProvider>
    </ShortcutSheetProvider>
  )
  const routed = tuneFormLauncher ? (
    <TuneFormLauncherProvider value={tuneFormLauncher}>{sheeted}</TuneFormLauncherProvider>
  ) : (
    <TuneFormProvider navigate={(to) => void router.navigate(to)}>{sheeted}</TuneFormProvider>
  )
  // Above the router, so practice's holds reach the bar and the overlay in every route, and the
  // dome, the capsule, and a tune page reach the one recorder.
  const practiced = (
    <PracticeOverlayStateProvider>
      <RecordStateProvider>
        <RecordLauncher>{routed}</RecordLauncher>
      </RecordStateProvider>
    </PracticeOverlayStateProvider>
  )
  // Above the router too, so the bars and practice reach the list that plays.
  const listed = <ListPlaybackProvider>{practiced}</ListPlaybackProvider>
  const played = player ? (
    <PlayerContext.Provider value={player}>{listed}</PlayerContext.Provider>
  ) : (
    <PlayerProvider>{listed}</PlayerProvider>
  )
  return (
    <BackStackProvider adapter={backAdapter}>
      <AppMotion>
        <ConfirmProvider>
          <ToastProvider>
            {/* Outside the router, so a loaded item keeps playing across every navigation.
                The player reaches the engine to prime it inside a play tap. */}
            {playbackEngine ? (
              <PlaybackEngineContext.Provider value={playbackEngine}>
                {played}
              </PlaybackEngineContext.Provider>
            ) : (
              <PlaybackEngineProvider>{played}</PlaybackEngineProvider>
            )}
          </ToastProvider>
        </ConfirmProvider>
      </AppMotion>
    </BackStackProvider>
  )
}

/** Hands the recorder's start to the shell's Record controls and the tune page. */
function RecordLauncher({ children }: { children: ReactNode }) {
  const { start } = useRecordState()
  const launcher = useMemo<Launcher>(() => ({ start, available: true }), [start])
  return (
    <RecordLauncherContext.Provider value={launcher}>{children}</RecordLauncherContext.Provider>
  )
}
