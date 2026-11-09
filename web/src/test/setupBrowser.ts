import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, vi } from 'vitest'
import { commands } from 'vitest/browser'
import '../app.css'
import { resetBackHistoryForTest } from '../layout/backHistory'
import { resetDestinationsForTest } from '../layout/destinations'
import { resetSelectingForTest } from '../features/selection/useScreenSelection'
import { resetOverlayClaimsForTest } from '../ui/overlayClaim'

declare module 'vitest/browser' {
  interface BrowserCommands {
    awaitTestFrame: (url: string) => Promise<void>
  }
}

// A click or key press before Playwright knows this file's iframe goes to the previous file's.
beforeAll(() => commands.awaitTestFrame(location.href))

afterEach(() => {
  // A test that times out mid-drag would otherwise leave the drag's fake clock behind.
  vi.useRealTimers()
  cleanup()
  resetOverlayClaimsForTest()
  resetSelectingForTest()
  resetDestinationsForTest()
  resetBackHistoryForTest()
  sessionStorage.clear()
  localStorage.clear()
})
