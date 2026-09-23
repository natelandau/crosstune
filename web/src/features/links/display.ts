import { PROVIDER_LABELS } from '../../constants'
import { isProvider } from './detect'

// A server row can name a provider this client predates; show it as a plain link.
export function providerLabel(link: { provider: string }): string {
  return isProvider(link.provider) ? PROVIDER_LABELS[link.provider] : PROVIDER_LABELS.other
}

/**
 * What to call a link: what the provider says it is, then what the musician called it, then
 * where it points. A bare host names nothing, so it is the last resort rather than the second.
 */
export function displayTitle(link: {
  title?: string | null
  label?: string | null
  url: string
}): string {
  if (link.title) return link.title
  if (link.label) return link.label
  try {
    return new URL(link.url).hostname
  } catch {
    return link.url
  }
}

const WEB_PROTOCOLS = new Set(['http:', 'https:'])

/**
 * Where a link may send the browser, or null when it must not be opened. A stored URL is
 * whatever was pasted, and any scheme but http and https can run in this page. A bare host,
 * pasted without a scheme, is read as https.
 */
export function outboundUrl(link: { url: string }): string | null {
  try {
    const parsed = new URL(link.url)
    return WEB_PROTOCOLS.has(parsed.protocol) ? parsed.href : null
  } catch {
    // No scheme at all, so not a script either.
  }
  try {
    const parsed = new URL(`https://${link.url.trim()}`)
    return parsed.href
  } catch {
    return null
  }
}
