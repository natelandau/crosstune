import { Repeat, Repeat1, Shuffle, SkipBack, SkipForward, type LucideIcon } from 'lucide-react'
import { SHUFFLE } from '../lists/listPlayCopy'
import type { RepeatMode } from './listQueue'
import { NEXT_TUNE, PREVIOUS_TUNE, REPEAT_LIST, REPEAT_OFF, REPEAT_TUNE } from './playerCopy'
import { useListPlayback } from './useListPlayback'
import { PracticeButton } from '../practice/PracticeButton'
import { Button } from '../../ui/Button'

const REPEAT_NAME: Record<RepeatMode, string> = {
  off: REPEAT_OFF,
  list: REPEAT_LIST,
  one: REPEAT_TUNE,
}

interface Control {
  id: string
  icon: LucideIcon
  label: string
  /** Set for a toggle: whether it is on. */
  pressed?: boolean
  onPress: () => void
}

/**
 * Shuffle, Previous tune, Next tune, and Repeat for the list that plays: on the dock, or on
 * jet in full-screen practice. Nothing shows while no list plays or one has stopped.
 */
export function QueueControls({ tone }: { tone: 'dock' | 'practice' }) {
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
        tone === 'dock' ? 'flex shrink-0 items-center' : 'flex items-center justify-center gap-6'
      }
    >
      {controls.map(({ id, icon, label, pressed, onPress }) =>
        tone === 'dock' ? (
          <Button
            key={id}
            icon={icon}
            label={label}
            iconOnly
            // A toggle that is on takes the fill, so on and off read apart at a glance.
            variant={pressed ? 'tinted' : 'plain'}
            aria-pressed={pressed}
            onPress={onPress}
          />
        ) : (
          <PracticeButton
            key={id}
            data-focus-key={id}
            icon={icon}
            label={label}
            iconClassName={`size-6 ${pressed === false ? 'text-(--panel-muted)' : ''}`}
            aria-pressed={pressed}
            onPress={onPress}
          />
        ),
      )}
    </div>
  )
}
