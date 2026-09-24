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
// A scheme as the URL parser reads it, after dropping C0 controls and spaces at either end
// and tabs and newlines anywhere. The API refuses a link on this same reading.
const URL_SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/
const URL_IGNORED = /[\t\n\r]/g

function schemeOf(url: string): string | null {
  let start = 0
  let end = url.length
  while (start < end && url.charCodeAt(start) <= 0x20) start++
  while (end > start && url.charCodeAt(end - 1) <= 0x20) end--
  const match = URL_SCHEME.exec(url.slice(start, end).replace(URL_IGNORED, ''))
  return match ? match[1]!.toLowerCase() : null
}

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
    // Does not parse as given. Only a scheme-less paste may be read as https.
  }
  const scheme = schemeOf(link.url)
  if (scheme !== null && !WEB_PROTOCOLS.has(`${scheme}:`)) return null
  try {
    const parsed = new URL(`https://${link.url.trim()}`)
    return parsed.href
  } catch {
    return null
  }
}
