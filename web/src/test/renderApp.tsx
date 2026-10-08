import { render, type RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'
import { onTestFinished } from 'vitest'
import { page } from 'vitest/browser'
import type { CrosstuneDb } from '../db/schema'
import type { PlaybackEngine } from '../features/player/playbackEngine'
import type { Player } from '../features/player/usePlayer'
import type { SyncEngine } from '../sync/types'
import { dataProviders, fakeEngine } from './providers'
import { App } from '../app/App'
import { createAppRouter, type AppRouter } from '../app/router'
import type { ShortcutSheetLauncher } from '../features/keyboard/shortcutSheetLauncher'
import type { Density } from '../platform/density'
import type { TuneFormLauncher } from '../features/tune/formLauncher'
import type { AndroidBackForTest } from './androidBack'
import { stampAxes } from './render'

interface RenderAppOptions {
  path: string
  db: CrosstuneDb
  density?: Density
  frame?: { width: number; height: number }
  sync?: Partial<SyncEngine>
  /** Wraps the app, such as in a provider a test stands in for. */
  wrap?: (app: ReactElement) => ReactElement
  /** Stands in for the tune form. */
  launcher?: TuneFormLauncher
  /** Stands in for the player. */
  player?: Player
  /** Stands in for the playback engine. */
  playbackEngine?: PlaybackEngine
  /** Hears back as Android does, from `useAndroidBackForTest`. */
  android?: AndroidBackForTest
  /** Stands in for the shortcut sheet. */
  shortcutSheet?: ShortcutSheetLauncher
}

const PHONE = { width: 390, height: 844 }

/**
 * Mounts the whole app at a path, with a signed-in session and a memory router. It resolves
 * once the router has settled its first navigation, so a test never races the router's start.
 */
export async function renderApp({
  path,
  db,
  density = 'pointer',
  frame = PHONE,
  sync,
  wrap = (app) => app,
  launcher,
  player,
  playbackEngine,
  android,
  shortcutSheet,
}: RenderAppOptions): Promise<RenderResult & { router: AppRouter }> {
  await page.viewport(frame.width, frame.height)
  onTestFinished(() => page.viewport(PHONE.width, PHONE.height))
  stampAxes({ density })
  const router = createAppRouter({ initialEntries: [path] })
  const result = render(
    wrap(
      <App
        router={router}
        tuneFormLauncher={launcher}
        player={player}
        playbackEngine={playbackEngine}
        backAdapter={android?.adapterFor(router)}
        shortcutSheet={shortcutSheet}
      />,
    ),
    {
      wrapper: dataProviders({ db, engine: fakeEngine(sync) }),
    },
  )
  onTestFinished(() => router.dispose())
  if (!router.state.initialized) {
    await new Promise<void>((resolve) => {
      const unsubscribe = router.subscribe((state) => {
        if (!state.initialized) return
        unsubscribe()
        resolve()
      })
    })
  }
  return Object.assign(result, { router })
}
