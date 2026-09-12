import type { LocalRecordingLink, Provider } from '../../db/types'
import { isProvider, youtubeId } from './detect'

const PROVIDER_LABELS: Record<Provider, string> = {
  youtube: 'YouTube',
  spotify: 'Spotify',
  apple_music: 'Apple Music',
  bandcamp: 'Bandcamp',
  soundcloud: 'SoundCloud',
  other: 'Link',
}

// A server row can name a provider this client predates; show it as a plain link.
function providerLabel(link: LocalRecordingLink): string {
  return isProvider(link.provider) ? PROVIDER_LABELS[link.provider] : PROVIDER_LABELS.other
}

function displayTitle(link: LocalRecordingLink): string {
  if (link.title) return link.title
  try {
    return new URL(link.url).hostname
  } catch {
    return link.url
  }
}

export function LinkList({
  links,
  playingId,
  onPlay,
  onRemove,
}: {
  links: LocalRecordingLink[]
  playingId: string | null
  onPlay: (id: string) => void
  onRemove: (id: string) => void
}) {
  if (links.length === 0) return <p className="text-sm opacity-70">No recordings linked yet.</p>
  return (
    <ul className="space-y-2">
      {links.map((link) => {
        const playable = youtubeId(link)
        return (
          <li
            key={link.id}
            className="bg-base-200 rounded-box flex min-h-14 items-center gap-3 px-3 py-2"
          >
            {link.artwork_url ? (
              <img src={link.artwork_url} alt="" className="h-10 w-10 rounded object-cover" />
            ) : (
              <span aria-hidden="true" className="badge badge-ghost h-10 w-10">
                {providerLabel(link)[0]}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{displayTitle(link)}</span>
              <span className="block truncate text-xs opacity-70">
                {[providerLabel(link), link.label].filter(Boolean).join(' · ')}
              </span>
            </span>
            {playable ? (
              <button
                type="button"
                className={`btn btn-sm ${playingId === link.id ? 'btn-primary' : ''}`}
                onClick={() => onPlay(link.id)}
                aria-label={`Play ${displayTitle(link)}`}
              >
                Play
              </button>
            ) : (
              <a
                className="btn btn-sm"
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open ${displayTitle(link)}`}
              >
                Open
              </a>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onRemove(link.id)}
              aria-label={`Remove ${displayTitle(link)}`}
            >
              ✕
            </button>
          </li>
        )
      })}
    </ul>
  )
}
