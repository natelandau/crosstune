import { Sheet } from '../../components/Sheet'
import { STATUSES, type SongStatus } from '../../db/types'
import type { CatalogEntry } from '../catalog/filters'
import { StatusDot } from '../catalog/StatusDot'
import { countSongs } from './copy'

export function StatusSheet({
  open,
  entries,
  onClose,
  onPick,
}: {
  open: boolean
  entries: readonly CatalogEntry[]
  onClose: () => void
  onPick: (status: SongStatus) => void
}) {
  return (
    <Sheet open={open} title={`Set status for ${countSongs(entries.length)}`} onClose={onClose}>
      <ul className="flex flex-col">
        {STATUSES.map((status) => {
          const current = entries.filter((entry) => entry.userSong.status === status).length
          return (
            <li key={status}>
              <button
                type="button"
                className="btn btn-ghost min-h-12 w-full justify-start text-base font-normal"
                onClick={() => onPick(status)}
              >
                <StatusDot status={status} />
                {current > 0 ? (
                  <span className="text-meta ml-auto opacity-70">{current} now</span>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>
      <button type="button" className="btn mt-3 min-h-11 w-full" onClick={onClose}>
        Cancel
      </button>
    </Sheet>
  )
}
