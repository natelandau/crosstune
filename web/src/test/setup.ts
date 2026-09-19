import { cleanup, configure } from '@testing-library/react'
import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import { afterEach } from 'vitest'

// jsdom's Blob/File carry no structured-clone support, so fake-indexeddb's
// structuredClone(value) silently drops their bytes on put(). Node's do.
if (typeof window !== 'undefined') {
  window.Blob = NodeBlob as unknown as typeof Blob
  window.File = NodeFile as unknown as typeof File
}

// vitest.config.ts doesn't enable `test.globals`, so RTL's own auto-cleanup
// (which only registers against a global afterEach) never runs on its own.
afterEach(() => {
  cleanup()
  if (typeof sessionStorage !== 'undefined') sessionStorage.clear()
})

// The first test in a file pays for opening a database, which under a loaded CPU can outlast
// Testing Library's one second default for findBy queries.
configure({ asyncUtilTimeout: 3000 })

// jsdom has no layout engine, so it doesn't implement scrollTo; the router calls
// it on every route mount to reset scroll position. Worker and script tests run
// in the node environment, where there is no window at all.
if (typeof window !== 'undefined') window.scrollTo = () => {}

// vitest's own jsdom polyfill for createObjectURL expects a jsdom-native Blob and throws
// on the Node Blob installed above; a stable fake avoids that and lets audio sources be asserted.
URL.createObjectURL = () => `blob:test/${crypto.randomUUID()}`
URL.revokeObjectURL = () => {}

// jsdom has HTMLDialogElement but no showModal or close; these toggle the attribute its stylesheet keys on.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function close() {
    if (!this.hasAttribute('open')) return
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
}

// jsdom has no layout, so no ResizeObserver, and no canvas backend; getContext returning null
// is what a canvas without one reports, and drawing components skip their work on it. Assigned
// rather than vi.stubGlobal'd, since tests that call vi.unstubAllGlobals() would remove a stub.
if (typeof window !== 'undefined' && typeof ResizeObserver === 'undefined') {
  class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver
}
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = () => null
}
