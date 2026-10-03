import type { PlayFirst } from '../../api/vocabulary'
import type { LocalRecording, LocalRecordingLink } from '../../db/types'
import type { PlayerItem } from './usePlayer'

interface Input {
  tuneId: string
  pin: { recordingId: string | null; linkId: string | null }
  /** In the order the tune screen shows them. */
  recordings: LocalRecording[]
  /** In the order the tune screen shows them. */
  links: LocalRecordingLink[]
  playFirst: PlayFirst
}

/**
 * What a list row plays for a tune: a valid pin, else the user's play-first choice, else
 * whatever exists. A pin counts only when its row is live and belongs to this tune.
 */
export function chooseRowSource(input: Input): PlayerItem | null {
  const { tuneId, pin } = input
  const recordings = input.recordings.filter((r) => !r.deleted_at && r.tune_id === tuneId)
  const links = input.links.filter((l) => !l.deleted_at && l.tune_id === tuneId)

  const pinnedRecording = recordings.find((r) => r.id === pin.recordingId)
  if (pinnedRecording) return { kind: 'recording', id: pinnedRecording.id }
  const pinnedLink = links.find((l) => l.id === pin.linkId)
  if (pinnedLink) return { kind: 'link', id: pinnedLink.id }

  const appleMusic = links.find((l) => l.provider === 'apple_music')
  if (input.playFirst === 'apple_music' && appleMusic) return { kind: 'link', id: appleMusic.id }
  if (recordings[0]) return { kind: 'recording', id: recordings[0].id }
  if (appleMusic) return { kind: 'link', id: appleMusic.id }
  if (links[0]) return { kind: 'link', id: links[0].id }
  return null
}
