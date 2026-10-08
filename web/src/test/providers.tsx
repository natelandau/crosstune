import type { ReactElement, ReactNode } from 'react'
import { vi } from 'vitest'
import { AuthProvider, type AuthSession } from '../auth/AuthContext'
import { DbContext } from '../db/DbProvider'
import type { CrosstuneDb } from '../db/schema'
import {
  PlaybackEngine,
  type CreateStage,
  type EngineClock,
} from '../features/player/playbackEngine'
import type { Player } from '../features/player/usePlayer'
import { SyncContext } from '../sync/SyncProvider'
import type { SyncEngine } from '../sync/types'
import { fakeEngine, testSession } from './fakeSync'

export { fakeEngine, testSession }

/** Stands in for a real `<audio>` element, which can neither decode a fake blob nor build a
 * Web Audio graph from one, so a test drives play state through events instead. Exported so a
 * test that needs `play()` to fail can override it on its own instance. */
export class FakeAudioElement extends EventTarget {
  src = ''
  currentTime = 0
  playbackRate = 1
  preservesPitch = false
  paused = true

  play(): Promise<void> {
    this.paused = false
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  }

  pause(): void {
    this.paused = true
    this.dispatchEvent(new Event('pause'))
  }
}

/** A player with nothing loaded whose every call is a spy, to watch what a tree asks of it. */
export function fakePlayer(overrides: Partial<Player> = {}): Player {
  return { item: null, play: vi.fn(), close: vi.fn(), returnFocus: vi.fn(), ...overrides }
}

export const realClock: EngineClock = {
  every: (ms, fn) => {
    const id = setInterval(fn, ms)
    return () => clearInterval(id)
  },
  after: (ms, fn) => {
    const id = setTimeout(fn, ms)
    return () => clearTimeout(id)
  },
}

/** Skips the real Signalsmith worklet, which needs a genuine `HTMLMediaElement` to attach to. */
const noopStage: CreateStage = async () => ({
  start: async () => {},
  stop: () => {},
  setTranspose: () => {},
  dispose: () => {},
})

/** A playback engine a test can drive and inspect without decoding real audio. Pass an
 * element (a `FakeAudioElement` whose `play` was overridden to reject, say) to control how
 * it behaves, and a clock to control its ticks. */
export function fakePlaybackEngine(
  element: HTMLAudioElement = new FakeAudioElement() as unknown as HTMLAudioElement,
  clock: EngineClock = realClock,
): PlaybackEngine {
  return new PlaybackEngine(element, clock, noopStage)
}

export interface ProviderOptions {
  db: CrosstuneDb
  engine?: SyncEngine
  session?: AuthSession
}

/**
 * The data a hook or component reads from context, with no router. Pass it to
 * `renderHook` or `render` as `wrapper`.
 */
export function dataProviders({
  db,
  engine = fakeEngine(),
  session = testSession,
}: ProviderOptions): ({ children }: { children: ReactNode }) => ReactElement {
  return function Providers({ children }) {
    return (
      <AuthProvider value={session}>
        <DbContext.Provider value={db}>
          <SyncContext.Provider value={engine}>{children}</SyncContext.Provider>
        </DbContext.Provider>
      </AuthProvider>
    )
  }
}
