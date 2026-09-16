import { useNavigate } from '@tanstack/react-router'
import { usePlayer } from '../player/usePlayer'
import { unlockAudioContext } from './audioContext'

/** Unlocks audio inside the tap so iOS lets the waveform run, then opens the recording screen. */
export function useStartRecording(): (songId?: string) => void {
  const navigate = useNavigate()
  const player = usePlayer()
  return (songId) => {
    unlockAudioContext()
    player.close()
    void navigate({ to: '/record', search: songId ? { song: songId } : {} })
  }
}
