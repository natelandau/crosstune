import { Link } from '@tanstack/react-router'
import { editedLabel } from './editedLabel'
import type { ListSummary } from './useLists'

export function ListRow({ list }: { list: ListSummary }) {
  return (
    <Link
      to="/lists/$id"
      params={{ id: list.id }}
      draggable={false}
      className="flex min-h-16 flex-col justify-center gap-0.5 px-3 py-2"
    >
      <span className="text-title truncate">{list.name}</span>
      <span className="text-meta opacity-70">
        {list.count} {list.count === 1 ? 'song' : 'songs'} · {editedLabel(list.lastEditedAt)}
      </span>
    </Link>
  )
}
