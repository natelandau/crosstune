import { PLAY_FIRST } from '../../api/vocabulary'
import type { PlayFirst } from '../../api/vocabulary'

export { PLAY_FIRST }

export const PLAY_FIRST_LABEL = 'Play first'

export const PLAY_FIRST_LABELS: Record<PlayFirst, string> = {
  recordings: 'Recordings',
  apple_music: 'Apple Music',
}

export const PLAY_FIRST_HELP =
  'Which plays first when a tune has both a recording and Apple Music, and none is pinned.'
