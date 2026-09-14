import type { ReactNode } from 'react'
import { SwipeRow, type SwipeAction } from '../../components/SwipeRow'
import type { SwipeRowState } from '../../components/swipe'
import type { Instrument } from '../../db/types'
import { SongCard } from './SongCard'
import type { CatalogEntry } from './filters'

/** A song as a swipeable two-row item, shared by every screen that lists songs. */
export function SongRow({
  entry,
  instruments,
  actions,
  leading,
  trailing,
  ...rowState
}: SwipeRowState & {
  entry: CatalogEntry
  instruments: ReadonlySet<Instrument>
  actions: readonly [SwipeAction, SwipeAction]
  leading?: ReactNode
  trailing?: ReactNode
}) {
  return (
    <SwipeRow name={entry.song.title} actions={actions} {...rowState}>
      <div className="flex items-center">
        {leading}
        <div className="min-w-0 flex-1">
          <SongCard entry={entry} instruments={instruments} />
        </div>
        {trailing}
      </div>
    </SwipeRow>
  )
}
