import { useEffect } from 'react'
import { DARK_QUERY, resolveDark, type Appearance } from '../features/settings/appearance'
import { PALETTE } from './tokens'

/** Resolves the same way as the inline script in index.html, which runs before first paint. */
export function applyScheme(appearance: Appearance): void {
  const root = document.documentElement
  const scheme = resolveDark(appearance) ? 'dark' : 'light'
  root.dataset.scheme = scheme
  root.style.colorScheme = scheme
  syncStatusBar(PALETTE[scheme].ground)
}

/**
 * Keeps the browser and home-screen status bar the page's color. The media pair in index.html
 * follows only the system, so a chosen scheme replaces it with the one color.
 */
function syncStatusBar(color: string): void {
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.remove())
  const meta = document.createElement('meta')
  meta.name = 'theme-color'
  meta.content = color
  document.head.append(meta)
}

/** Applies the appearance, and follows the system's scheme only while the appearance is System. */
export function useSchemeSync(appearance: Appearance): void {
  useEffect(() => {
    applyScheme(appearance)
    if (appearance !== 'system') return
    const list = window.matchMedia?.(DARK_QUERY)
    if (!list) return
    const follow = () => applyScheme('system')
    list.addEventListener('change', follow)
    return () => list.removeEventListener('change', follow)
  }, [appearance])
}
