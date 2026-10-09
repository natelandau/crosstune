import { Play, Shuffle, SquarePen, Trash2 } from 'lucide-react'
import { Button as AriaButton } from 'react-aria-components'
import { editedLabel } from './editedLabel'
import { pauseListName, playListName, SHUFFLE } from './listPlayCopy'
import { RENAME } from './listsCopy'
import type { ListSummary } from './useLists'
import { usePlaybackEngine, useEngineState } from '../player/PlaybackEngineProvider'
import { PLAY } from '../player/transportCopy'
import { useListPlayback } from '../player/useListPlayback'
import { countTunes } from '../selection/copy'
import { useStampedDensity } from '../../platform/density'
import { DELETE } from '../../ui/confirmCopy'
import { Row, type RowAction } from '../../ui/Row'
import { PauseGlyph, PlayGlyph } from '../../ui/rowGlyphs'
import { useNow } from '../../ui/useNow'

const SLOT = 'grid size-(--target-control) shrink-0 place-items-center'

/**
 * The list's own play control, trailing. While the list plays it pauses and resumes; otherwise
 * it plays the list. On pointer it shows on hover or focus, unless the list is playing.
 */
function ListPlayControl({
  name,
  active,
  settled,
  onPlay,
}: {
  name: string
  active: boolean
  /** The player holds the playing list's current tune; false while the next one loads. */
  settled: boolean
  onPlay: () => void
}) {
  const engine = usePlaybackEngine()
  const playing = useEngineState(engine, (state) => state.playing)
  const hover = useStampedDensity() === 'pointer' && !active
  const pausing = active && playing
  return (
    <AriaButton
      aria-label={pausing ? pauseListName(name) : playListName(name)}
      // Until the next tune loads, the engine holds the one being left.
      isDisabled={active && !settled}
      onPress={() => {
        if (!active) onPlay()
        else if (pausing) engine.pause()
        else engine.play()
      }}
      className={`${SLOT} rounded-full data-[pressed]:opacity-60 ${active ? 'text-slate' : 'text-ink-2'} ${
        hover
          ? 'opacity-0 transition-opacity duration-(--dur-short) ease-(--ease) group-hover:opacity-100 data-[focus-visible]:opacity-100'
          : ''
      }`}
    >
      {pausing ? <PauseGlyph /> : <PlayGlyph />}
    </AriaButton>
  )
}

/**
 * One list among the lists: its name, then its tune count and when it was last edited. A list
 * with a tune that plays offers Play trailing and Play and Shuffle in its menu; one without
 * keeps the slot empty, so every row's text ends in one place.
 */
export function ListRow({
  list,
  playable,
  onPlay,
  onRename,
  onDelete,
}: {
  list: ListSummary
  /** Undefined until the lists' sources have read. */
  playable: boolean | undefined
  onPlay: (options: { shuffle?: boolean }) => void
  onRename: () => void
  onDelete: () => void
}) {
  const count = countTunes(list.count)
  const edited = editedLabel(list.lastEditedAt, new Date(useNow()))
  const run = useListPlayback().active
  const active = run?.listId === list.id && run.message === null
  const actions: RowAction[] = [
    { id: 'rename', label: RENAME, icon: SquarePen, onAction: onRename },
    { id: 'delete', label: DELETE, icon: Trash2, tone: 'danger', onAction: onDelete },
  ]
  const plays: RowAction[] = playable
    ? [
        { id: 'play', label: PLAY, icon: Play, onAction: () => onPlay({ shuffle: false }) },
        { id: 'shuffle', label: SHUFFLE, icon: Shuffle, onAction: () => onPlay({ shuffle: true }) },
      ]
    : []
  return (
    <Row
      id={list.id}
      textValue={`${list.name}, ${count}, ${edited}`}
      title={list.name}
      stacked
      playing={active}
      detail={
        <>
          <span className="sr-only">, </span>
          <span className="t-num">{count}</span>
          <span aria-hidden> · </span>
          <span className="sr-only">, </span>
          {edited}
        </>
      }
      trailing={
        playable || active ? (
          <ListPlayControl
            name={list.name}
            active={active}
            settled={run?.settled ?? false}
            onPlay={() => onPlay({})}
          />
        ) : (
          <span className={SLOT} />
        )
      }
      actions={actions}
      menu={[...plays, ...actions]}
    />
  )
}
