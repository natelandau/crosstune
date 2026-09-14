import { Link } from '@tanstack/react-router'
import type { Instrument } from '../../db/types'
import { TUNING_FIELDS, TUNING_FIELD_NAMES } from '../settings/instruments'
import { StatusDot } from './StatusDot'
import type { CatalogEntry } from './filters'

export function SongCard({
  entry: { song, userSong },
  instruments,
}: {
  entry: CatalogEntry
  instruments: ReadonlySet<Instrument>
}) {
  const tunings = TUNING_FIELD_NAMES.filter((field) =>
    instruments.has(TUNING_FIELDS[field].instrument),
  )
    .map((field) => song[field])
    .filter(Boolean)
    .join(' · ')
  const archived = userSong.archived_at !== null
  return (
    // Dim the link, not SwipeRow's front layer, which must stay opaque over the action buttons.
    <Link
      to="/songs/$id"
      params={{ id: song.id }}
      draggable={false}
      className={`flex min-h-16 flex-col justify-center gap-0.5 px-3 py-2 ${archived ? 'opacity-60' : ''}`}
    >
      <span className="truncate text-lg font-semibold">{song.title}</span>
      <span className="flex min-w-0 items-center gap-3 text-sm">
        {song.key ? (
          <span className="font-bold">
            <span className="sr-only">Key </span>
            {song.key}
          </span>
        ) : null}
        <StatusDot status={userSong.status} />
        {tunings ? <span className="truncate opacity-70">{tunings}</span> : null}
        {archived ? <span>Archived</span> : null}
      </span>
    </Link>
  )
}
