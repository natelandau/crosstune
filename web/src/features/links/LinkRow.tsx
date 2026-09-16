import { ArrowUpRight, Trash2 } from 'lucide-react'
import { SwipeRow } from '../../components/SwipeRow'
import type { SwipeRowState } from '../../components/swipe'
import type { LocalRecordingLink } from '../../db/types'
import { useOnline } from '../../sync/SyncProvider'
import { embedFor } from '../player/embed'
import { PlayGlyph, ROW_CLASS, Slot, StopGlyph } from '../player/rowGlyphs'
import { isPlaying, usePlayer } from '../player/usePlayer'
import { displayTitle, providerLabel } from './display'

/**
 * A linked recording as a row shaped like an audio recording's: the row plays it when the provider can be
 * embedded, and the trailing button opens it on the provider's own site. Remove is behind a swipe.
 */
export function LinkRow({
  link,
  onRemove,
  ...rowState
}: SwipeRowState & {
  link: LocalRecordingLink
  onRemove: (id: string) => void
}) {
  const online = useOnline()
  const player = usePlayer()
  const title = displayTitle(link)
  const provider = providerLabel(link)
  const embed = embedFor(link)
  const item = { kind: 'link' as const, id: link.id }
  const loaded = isPlaying(player, item)

  const body = (
    <>
      {link.artwork_url ? (
        <img src={link.artwork_url} alt="" className="ml-1 size-10 shrink-0 rounded object-cover" />
      ) : (
        <span aria-hidden="true" className="badge badge-outline ml-1 size-10 shrink-0 opacity-60">
          {provider[0]}
        </span>
      )}
      <span className="min-w-0 flex-1 pl-2">
        <span className="block truncate font-medium">{title}</span>
        {link.label ? (
          <span className="text-small block truncate opacity-70">{link.label}</span>
        ) : null}
      </span>
    </>
  )

  return (
    <li>
      <SwipeRow
        name={title}
        actions={[
          {
            label: 'Remove',
            tone: 'error',
            icon: <Trash2 aria-hidden="true" className="size-5" />,
            onPress: () => onRemove(link.id),
          },
        ]}
        {...rowState}
      >
        <div className="rounded-box flex items-center">
          {embed ? (
            <button
              type="button"
              className={`${ROW_CLASS} ${online || loaded ? '' : 'opacity-60'}`}
              // Refused rather than disabled while offline, so focus stays here when Close turns into Play.
              onClick={() => {
                if (loaded) player.close()
                else if (online) player.play(item)
              }}
              aria-disabled={!loaded && !online ? true : undefined}
              aria-label={loaded ? `Close ${title} player` : `Play ${title}`}
            >
              <Slot>{loaded ? <StopGlyph /> : <PlayGlyph />}</Slot>
              {body}
            </button>
          ) : (
            <div className={ROW_CLASS}>
              <Slot />
              {body}
            </div>
          )}
          <a
            className="btn btn-ghost btn-sm mr-1 min-h-11 min-w-11 gap-1"
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${title} on ${provider}`}
          >
            {provider === 'Link' ? 'Open' : provider}
            <ArrowUpRight aria-hidden="true" className="size-4" />
          </a>
        </div>
      </SwipeRow>
    </li>
  )
}
