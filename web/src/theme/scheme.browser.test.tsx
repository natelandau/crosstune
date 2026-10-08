import { act, render } from '@testing-library/react'
import { expect, it, onTestFinished } from 'vitest'
import { APPEARANCE_KEY, setAppearance, useAppearance } from './appearance'
import { applyScheme, useSchemeSync } from './scheme'
import { PALETTE } from './tokens'

function themeColors() {
  return [...document.head.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map(
    (meta) => meta.content,
  )
}

/** Puts the root's scheme and the head's theme-color tags back once the test finishes. */
function restoreHead() {
  const root = document.documentElement
  const before = { scheme: root.dataset.scheme, colorScheme: root.style.colorScheme }
  const metas = [...document.head.querySelectorAll('meta[name="theme-color"]')]
  onTestFinished(() => {
    if (before.scheme === undefined) delete root.dataset.scheme
    else root.dataset.scheme = before.scheme
    root.style.colorScheme = before.colorScheme
    document.head.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.remove())
    document.head.append(...metas)
  })
}

function storageChangedElsewhere(key: string | null) {
  window.dispatchEvent(new StorageEvent('storage', { key }))
}

it.each(['light', 'dark'] as const)('colors the status bar with the %s page', (scheme) => {
  restoreHead()
  applyScheme(scheme)
  expect(themeColors()).toEqual([PALETTE[scheme].ground])
})

function SchemeSync() {
  useSchemeSync(useAppearance())
  return null
}

it('keeps the status bar dark through a storage event that leaves the appearance as it was', async () => {
  restoreHead()
  onTestFinished(() => {
    // The appearance lives in module memory as well as storage, so a cleared-storage event is
    // what resets it for the next test.
    localStorage.clear()
    storageChangedElsewhere(null)
  })
  setAppearance('dark')
  render(<SchemeSync />)
  await expect.poll(themeColors).toEqual([PALETTE.dark.ground])
  act(() => storageChangedElsewhere(APPEARANCE_KEY))
  expect(themeColors()).toEqual([PALETTE.dark.ground])
})
