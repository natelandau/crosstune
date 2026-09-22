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
