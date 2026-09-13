import { Link } from '@tanstack/react-router'
import { StatusBadge } from './StatusBadge'
import type { CatalogEntry } from './filters'

export function SongCard({ entry: { song, userSong } }: { entry: CatalogEntry }) {
  const facets = [song.mode, song.violin_tuning, song.banjo_tuning, song.feel]
    .filter(Boolean)
    .join(' · ')
  return (
    <Link
      to="/songs/$id"
      params={{ id: song.id }}
      className="bg-base-200 rounded-box flex min-h-16 items-center gap-3 px-3 py-2 active:opacity-80"
    >
      <span
        className="badge badge-primary badge-lg w-14 shrink-0 justify-center text-lg font-bold"
        aria-label={song.key ? `Key ${song.key}` : 'No key'}
      >
        {song.key ?? '·'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{song.title}</span>
        {facets ? <span className="block truncate text-xs opacity-70">{facets}</span> : null}
      </span>
      <StatusBadge status={userSong.status} />
    </Link>
  )
}
