import { cleanup } from '@testing-library/react'
import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'

// vitest.config.ts doesn't enable `test.globals`, so RTL's own auto-cleanup
// (which only registers against a global afterEach) never runs on its own.
afterEach(() => {
  cleanup()
})

// jsdom has no layout engine, so it doesn't implement scrollTo; the router calls
// it on every route mount to reset scroll position. Worker and script tests run
// in the node environment, where there is no window at all.
if (typeof window !== 'undefined') window.scrollTo = () => {}
