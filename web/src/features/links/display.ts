import type { Provider } from '../../db/types'
import { isProvider } from './detect'

const PROVIDER_LABELS: Record<Provider, string> = {
  youtube: 'YouTube',
  spotify: 'Spotify',
  apple_music: 'Apple Music',
  bandcamp: 'Bandcamp',
  soundcloud: 'SoundCloud',
  tidal: 'TIDAL',
  internet_archive: 'Internet Archive',
  other: 'Link',
}

// A server row can name a provider this client predates; show it as a plain link.
export function providerLabel(link: { provider: string }): string {
  return isProvider(link.provider) ? PROVIDER_LABELS[link.provider] : PROVIDER_LABELS.other
}

export function displayTitle(link: { title?: string | null; url: string }): string {
  if (link.title) return link.title
  try {
    return new URL(link.url).hostname
  } catch {
    return link.url
  }
}
