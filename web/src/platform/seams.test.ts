import { afterEach, describe, expect, it, vi } from 'vitest'
import { tap } from './haptics'
import { syncStatusBar } from './statusBar'

afterEach(() => {
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.remove())
  document.documentElement.style.removeProperty('--ion-background-color')
})

describe('tap', () => {
  it('vibrates briefly where the browser can', () => {
    const vibrate = vi.fn()
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true })
    tap()
    expect(vibrate).toHaveBeenCalledWith(10)
  })

  it('does nothing where it cannot', () => {
    Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true })
    expect(() => tap()).not.toThrow()
  })
})

describe('syncStatusBar', () => {
  it('writes the page background to the theme-color meta tag', () => {
    document.documentElement.style.setProperty('--ion-background-color', '#123456')
    syncStatusBar()
    const meta = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    expect(meta?.content).toBe('#123456')
  })

  it('replaces the two media-scoped tags the page ships with one tag', () => {
    for (const scheme of ['light', 'dark']) {
      const meta = document.createElement('meta')
      meta.name = 'theme-color'
      meta.media = `(prefers-color-scheme: ${scheme})`
      document.head.append(meta)
    }
    document.documentElement.style.setProperty('--ion-background-color', '#abcdef')
    syncStatusBar()
    const metas = document.head.querySelectorAll('meta[name="theme-color"]')
    expect(metas).toHaveLength(1)
    expect(metas[0]?.getAttribute('media')).toBeNull()
  })

  it('writes the light page color when Ionic leaves the variable unset', () => {
    document.documentElement.style.setProperty('--ion-background-color', '#000000')
    syncStatusBar()
    document.documentElement.style.removeProperty('--ion-background-color')
    syncStatusBar()
    const metas = document.head.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    expect(metas).toHaveLength(1)
    expect(metas[0]?.content).toBe('#ffffff')
  })
})
