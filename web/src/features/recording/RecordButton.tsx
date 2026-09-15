import { useNavigate } from '@tanstack/react-router'
import { usePlayer } from '../player/usePlayer'
import { unlockAudioContext } from './audioContext'

/** Start a take, for a song or unfiled. Unlocks audio inside the tap so iOS lets the waveform run. */
function useLaunchRecord(songId?: string): () => void {
  const navigate = useNavigate()
  const player = usePlayer()
  return () => {
    unlockAudioContext()
    player.close()
    void navigate({ to: '/record', search: songId ? { song: songId } : {} })
  }
}

/** The Dock's center control. */
export function RecordButton() {
  const launch = useLaunchRecord()
  return (
    <button
      type="button"
      className="record-button min-h-11 min-w-11"
      aria-label="Record a new take"
      onClick={launch}
    >
      <span aria-hidden="true" className="record-button-dot" />
    </button>
  )
}

/** A plain Record button for a screen that already shows the song, unlike the Dock's icon. */
export function RecordButtonInline({ songId }: { songId: string }) {
  const launch = useLaunchRecord(songId)
  return (
    <button type="button" className="btn btn-error min-h-11" onClick={launch}>
      Record
    </button>
  )
}
