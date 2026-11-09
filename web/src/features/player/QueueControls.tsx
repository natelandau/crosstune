import { Repeat, Repeat1, Shuffle, SkipBack, SkipForward, type LucideIcon } from 'lucide-react'
import { SHUFFLE } from '../lists/listPlayCopy'
import type { RepeatMode } from './listQueue'
import { NEXT_TUNE, PREVIOUS_TUNE, REPEAT_LIST, REPEAT_OFF, REPEAT_TUNE } from './playerCopy'
import { useListPlayback } from './useListPlayback'
import { isPlaying, usePlayer } from './usePlayer'
import { IconButton } from '../../ui/IconButton'

const REPEAT_NAME: Record<RepeatMode, string> = {
  off: REPEAT_OFF,
  list: REPEAT_LIST,
  one: REPEAT_TUNE,
}

type Tone = 'bar' | 'practice'

interface Control {
  id: string
  icon: LucideIcon
  label: string
  /** Set for a toggle: whether it is on. */
  pressed?: boolean
  onPress: () => void
}

/**
 * Shuffle, Previous tune, Next tune, and Repeat for the list that plays: in the dock's bar or
 * practice's transport. Nothing shows while no list plays or one has stopped, nor on a
 * recording's page while the player holds another item.
 */
export function QueueControls({
  tone,
  recordingId,
}: {
  tone: Tone
  /** The recording a page shows, the only one whose list controls it shows. */
  recordingId?: string
}) {
  const player = usePlayer()
  if (recordingId !== undefined && !isPlaying(player, { kind: 'recording', id: recordingId })) {
    return null
  }
  return <ListControls tone={tone} />
}

function ListControls({ tone }: { tone: Tone }) {
  const playback = useListPlayback()
  const { active } = playback
  if (!active || active.message !== null) return null
  const controls: Control[] = [
    {
      id: 'shuffle',
      icon: Shuffle,
      label: SHUFFLE,
      pressed: active.shuffled,
      onPress: playback.toggleShuffle,
    },
    { id: 'previous', icon: SkipBack, label: PREVIOUS_TUNE, onPress: playback.previous },
    { id: 'next', icon: SkipForward, label: NEXT_TUNE, onPress: playback.next },
    {
      // Keyed apart from its name, which changes with the mode, so focus stays on it.
      id: 'repeat',
      icon: active.repeat === 'one' ? Repeat1 : Repeat,
      label: REPEAT_NAME[active.repeat],
      pressed: active.repeat !== 'off',
      onPress: playback.cycleRepeat,
    },
  ]
  return (
    <div
      data-queue-controls
      className={
        tone === 'bar' ? 'flex shrink-0 items-center' : 'flex items-center justify-center gap-6'
      }
    >
      {controls.map(({ id, icon, label, pressed, onPress }) => (
        <IconButton
          key={id}
          data-focus-key={tone === 'practice' ? id : undefined}
          icon={icon}
          label={label}
          size={tone === 'practice' ? 'large44' : undefined}
          variant={pressed === undefined ? 'plain' : 'toggle'}
          isSelected={pressed}
          onChange={pressed === undefined ? undefined : () => onPress()}
          onPress={pressed === undefined ? onPress : undefined}
        />
      ))}
    </div>
  )
}
