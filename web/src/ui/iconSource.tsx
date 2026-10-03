import type { LucideIcon } from 'lucide-react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'

const sources = new Map<LucideIcon, string>()

/**
 * The icon as an SVG data URL, for an Ionic overlay that takes `icon` as a string, such as an
 * action sheet button. It keeps the one icon set: the URL is the lucide icon's own markup, and
 * its `currentColor` stroke follows the button's text color once ion-icon inlines it.
 */
export function iconSource(Icon: LucideIcon): string {
  let source = sources.get(Icon)
  if (source === undefined) {
    const host = document.createElement('div')
    const root = createRoot(host)
    flushSync(() => root.render(<Icon aria-hidden />))
    // Raw, not percent-encoded: ion-icon reads a `;utf8,` URL's markup in place rather than
    // fetching it, which also keeps it clear of the page's connect-src policy.
    source = `data:image/svg+xml;utf8,${host.innerHTML}`
    root.unmount()
    sources.set(Icon, source)
  }
  return source
}
