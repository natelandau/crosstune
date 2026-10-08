import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import '../app.css'
import { resetBackTrailForTest } from '../app/backTrail'
import { resetDestinationsForTest } from '../app/destinations'
import { resetSelectingForTest } from '../features/selection/useScreenSelection'
import { resetOverlayClaimsForTest } from '../ui/overlayClaim'

afterEach(() => {
  // A test that times out mid-drag would otherwise leave the drag's fake clock behind.
  vi.useRealTimers()
  cleanup()
  resetOverlayClaimsForTest()
  resetSelectingForTest()
  resetDestinationsForTest()
  resetBackTrailForTest()
  sessionStorage.clear()
  localStorage.clear()
})
