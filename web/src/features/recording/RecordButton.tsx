import { useNavigate } from '@tanstack/react-router'
import { usePlayer } from '../player/usePlayer'
import { unlockAudioContext } from './audioContext'

/** The Dock's center control and the only way to start a recording. Unlocks audio inside the
 * tap so iOS lets the waveform run. */
export function RecordButton() {
  const navigate = useNavigate()
  const player = usePlayer()
  return (
    <button
      type="button"
      className="record-button min-h-11 min-w-11"
      aria-label="Start a new recording"
      onClick={() => {
        unlockAudioContext()
        player.close()
        void navigate({ to: '/record' })
      }}
    >
      <span aria-hidden="true" className="record-button-dot" />
    </button>
  )
}
