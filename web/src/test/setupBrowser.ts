import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import '../app.css'
import { resetBackHistoryForTest } from '../layout/backHistory'
import { resetDestinationsForTest } from '../layout/destinations'
import { resetSelectingForTest } from '../features/selection/useScreenSelection'
import { resetOverlayClaimsForTest } from '../ui/overlayClaim'

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
