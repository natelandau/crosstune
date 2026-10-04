import type { LucideIcon } from 'lucide-react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'

const sources = new Map<LucideIcon, string>()
const pairs = new Map<LucideIcon, Map<LucideIcon, string>>()

function render(Icon: LucideIcon): SVGSVGElement {
  const host = document.createElement('div')
  const root = createRoot(host)
  flushSync(() => root.render(<Icon aria-hidden />))
  const svg = host.querySelector('svg')!
  root.unmount()
  return svg
}

/**
 * The icon as an SVG data URL, for an Ionic overlay that takes `icon` as a string, such as an
 * action sheet button. It keeps the one icon set: the URL is the lucide icon's own markup, and
 * its `currentColor` stroke follows the button's text color once ion-icon inlines it.
 */
export function iconSource(Icon: LucideIcon): string {
  let source = sources.get(Icon)
  if (source === undefined) {
    // Raw, not percent-encoded: ion-icon reads a `;utf8,` URL's markup in place rather than
    // fetching it, which also keeps it clear of the page's connect-src policy.
    source = `data:image/svg+xml;utf8,${render(Icon).outerHTML}`
    sources.set(Icon, source)
  }
  return source
}

/**
 * Two icons side by side as one data URL, for an overlay button that has a single icon slot.
 * The second icon's paths move into a group rather than a nested svg, since ion-icon stretches
 * every svg it holds to fill the icon. Its button needs the `menu-icon-pair` class, which widens
 * the icon to the pair's 52:24 shape.
 */
export function iconPairSource(First: LucideIcon, Second: LucideIcon): string {
  let byFirst = pairs.get(First)
  if (byFirst === undefined) pairs.set(First, (byFirst = new Map()))
  let source = byFirst.get(Second)
  if (source === undefined) {
    const first = render(First)
    const second = render(Second)
    first.setAttribute('viewBox', '0 0 52 24')
    first.setAttribute('width', '52')
    first.setAttribute('class', `${first.getAttribute('class')} ${second.getAttribute('class')}`)
    const shifted = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    shifted.setAttribute('transform', 'translate(28 0)')
    shifted.append(...second.childNodes)
    first.append(shifted)
    source = `data:image/svg+xml;utf8,${first.outerHTML}`
    byFirst.set(Second, source)
  }
  return source
}
