import { useNavigate } from '@tanstack/react-router'
import { usePlayer } from '../player/usePlayer'
import { unlockAudioContext } from './audioContext'

/** The Dock's center control. Unlocks audio inside the tap so iOS lets the waveform run. */
export function RecordButton({ songId }: { songId?: string }) {
  const navigate = useNavigate()
  const player = usePlayer()
  return (
    <button
      type="button"
      className="record-button min-h-11 min-w-11"
      aria-label="Record a new take"
      onClick={() => {
        unlockAudioContext()
        player.close()
        void navigate({ to: '/record', search: songId ? { song: songId } : {} })
      }}
    >
      <span aria-hidden="true" className="record-button-dot" />
    </button>
  )
}

/** A plain Record button for a screen that already shows the song, unlike the Dock's icon. */
export function RecordButtonInline({ songId }: { songId: string }) {
  const navigate = useNavigate()
  const player = usePlayer()
  return (
    <button
      type="button"
      className="btn btn-error min-h-11"
      onClick={() => {
        unlockAudioContext()
        player.close()
        void navigate({ to: '/record', search: { song: songId } })
      }}
    >
      Record
    </button>
  )
}
