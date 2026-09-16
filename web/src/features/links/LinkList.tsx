import type { LocalRecordingLink } from '../../db/types'
import { useOnline } from '../../sync/SyncProvider'
import { embedFor } from '../player/embed'
import { PlayButton } from '../player/PlayButton'
import { isPlaying, usePlayer } from '../player/usePlayer'
import { displayTitle, linkSubtitle, providerLabel } from './display'

export function LinkList({
  links,
  onRemove,
}: {
  links: LocalRecordingLink[]
  onRemove: (id: string) => void
}) {
  const online = useOnline()
  const player = usePlayer()
  if (links.length === 0) return <p className="text-sm opacity-70">No recordings linked yet.</p>
  return (
    <ul className="space-y-2" aria-label="Links">
      {links.map((link) => {
        const title = displayTitle(link)
        const embed = embedFor(link)
        const loaded = isPlaying(player, { kind: 'link', id: link.id })
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
              <span className="block truncate font-medium">{title}</span>
              <span className="block truncate text-xs opacity-70">{linkSubtitle(link)}</span>
            </span>
            {embed ? (
              <PlayButton
                title={title}
                loaded={loaded}
                onPlay={() => player.play({ kind: 'link', id: link.id })}
                onClose={player.close}
                // Refused rather than disabled, so focus stays here when Close turns into Play while offline.
                playDisabled={!online}
              />
            ) : null}
            <a
              className="btn btn-sm min-h-11 min-w-11"
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${title}`}
            >
              Open
            </a>
            <button
              type="button"
              className="btn btn-ghost btn-sm min-h-11 min-w-11"
              onClick={() => onRemove(link.id)}
              aria-label={`Remove ${title}`}
            >
              ✕
            </button>
          </li>
        )
      })}
    </ul>
  )
}
